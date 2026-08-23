use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

#[derive(Default)]
pub struct FileDialogState {
    last_directory: std::sync::Mutex<Option<PathBuf>>,
}

#[derive(Serialize)]
pub struct OpenedFile {
    name: String,
    path: String,
    data: Vec<u8>,
}

#[derive(Serialize)]
pub struct SavedPath {
    path: String,
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum NativeResult<T> {
    Success {
        ok: bool,
        value: T,
    },
    Canceled {
        ok: bool,
        canceled: bool,
    },
    Failed {
        ok: bool,
        canceled: bool,
        error: String,
    },
}

impl<T> NativeResult<T> {
    fn success(value: T) -> Self {
        Self::Success { ok: true, value }
    }

    fn canceled() -> Self {
        Self::Canceled {
            ok: false,
            canceled: true,
        }
    }

    fn failed(error: impl Into<String>) -> Self {
        Self::Failed {
            ok: false,
            canceled: false,
            error: error.into(),
        }
    }
}

fn valid_file_name(name: &str) -> bool {
    let trimmed = name.trim();
    !trimmed.is_empty()
        && trimmed != "."
        && trimmed != ".."
        && trimmed.chars().count() <= 255
        && !trimmed.ends_with('.')
        && !trimmed.ends_with(' ')
        && trimmed.chars().all(|character| {
            character >= ' '
                && !matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
        })
}

fn validate_file_names(files: &[ExportFile]) -> Result<(), String> {
    let mut names = std::collections::HashSet::new();
    for file in files {
        if !valid_file_name(&file.name) {
            return Err(format!("Invalid export file name: {}", file.name));
        }
        let key = file.name.to_lowercase();
        if !names.insert(key) {
            return Err(format!("Duplicate export file name: {}", file.name));
        }
    }
    if files.is_empty() || files.len() > 8 {
        return Err("The export must contain between one and eight files".to_string());
    }
    Ok(())
}

#[derive(Serialize)]
pub struct AppInfo {
    name: String,
    version: String,
    platform: &'static str,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct LastDirectory {
    last_directory: PathBuf,
}

fn path_from_dialog(file: FilePath) -> Option<PathBuf> {
    match file {
        FilePath::Path(path) => Some(path),
        FilePath::Url(url) => url.to_file_path().ok(),
    }
}

fn state_file(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("file-dialog-state.json"))
        .map_err(|error| error.to_string())
}

fn last_directory(app: &AppHandle, state: &State<'_, FileDialogState>) -> Option<PathBuf> {
    if let Some(directory) = state
        .last_directory
        .lock()
        .ok()
        .and_then(|value| value.clone())
    {
        if directory.is_dir() {
            return Some(directory);
        }
    }

    let path = state_file(app).ok()?;
    let directory = serde_json::from_slice::<LastDirectory>(&fs::read(path).ok()?)
        .ok()?
        .last_directory;
    if directory.is_dir() {
        if let Ok(mut value) = state.last_directory.lock() {
            *value = Some(directory.clone());
        }
        Some(directory)
    } else {
        None
    }
}

fn remember_directory(app: &AppHandle, state: &State<'_, FileDialogState>, directory: &Path) {
    if let Ok(mut value) = state.last_directory.lock() {
        *value = Some(directory.to_path_buf());
    }
    let Some(path) = state_file(app).ok() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(data) = serde_json::to_vec(&LastDirectory {
        last_directory: directory.to_path_buf(),
    }) {
        let _ = fs::write(path, data);
    }
}

fn open_file(
    app: AppHandle,
    state: State<'_, FileDialogState>,
    description: &'static str,
    extensions: &'static [&'static str],
) -> NativeResult<OpenedFile> {
    let mut builder = app.dialog().file().add_filter(description, extensions);
    if let Some(directory) = last_directory(&app, &state) {
        builder = builder.set_directory(directory);
    }
    let Some(selected) = builder.blocking_pick_file() else {
        return NativeResult::canceled();
    };
    let Some(path) = path_from_dialog(selected) else {
        return NativeResult::failed("The selected path is not a local file");
    };

    match fs::read(&path) {
        Ok(data) => {
            if let Some(directory) = path.parent() {
                remember_directory(&app, &state, directory);
            }
            NativeResult::success(OpenedFile {
                name: path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default()
                    .to_string(),
                path: path.to_string_lossy().into_owned(),
                data,
            })
        }
        Err(error) => NativeResult::failed(error.to_string()),
    }
}

#[tauri::command]
fn open_step_file(app: AppHandle, state: State<'_, FileDialogState>) -> NativeResult<OpenedFile> {
    open_file(app, state, "STEP model", &["step", "stp"])
}

#[tauri::command]
fn open_project_file(
    app: AppHandle,
    state: State<'_, FileDialogState>,
) -> NativeResult<OpenedFile> {
    open_file(app, state, "MoldMaker project", &["moldmaker"])
}

#[derive(serde::Deserialize)]
struct SaveProjectRequest {
    #[serde(rename = "suggestedName")]
    suggested_name: String,
    data: Vec<u8>,
}

#[tauri::command]
fn save_project_file(
    app: AppHandle,
    state: State<'_, FileDialogState>,
    request: SaveProjectRequest,
) -> NativeResult<SavedPath> {
    if !valid_file_name(&request.suggested_name) {
        return NativeResult::failed("Invalid project file name");
    }
    let suggested_name = if request
        .suggested_name
        .to_ascii_lowercase()
        .ends_with(".moldmaker")
    {
        request.suggested_name
    } else {
        format!("{}.moldmaker", request.suggested_name)
    };
    let mut builder = app
        .dialog()
        .file()
        .add_filter("MoldMaker project", &["moldmaker"]);
    if let Some(directory) = last_directory(&app, &state) {
        builder = builder.set_directory(directory);
    }
    let Some(selected) = builder.set_file_name(&suggested_name).blocking_save_file() else {
        return NativeResult::canceled();
    };
    let Some(path) = path_from_dialog(selected) else {
        return NativeResult::failed("The selected path is not a local file");
    };

    match fs::write(&path, request.data) {
        Ok(()) => {
            if let Some(directory) = path.parent() {
                remember_directory(&app, &state, directory);
            }
            NativeResult::success(SavedPath {
                path: path.to_string_lossy().into_owned(),
            })
        }
        Err(error) => NativeResult::failed(error.to_string()),
    }
}

#[derive(serde::Deserialize)]
struct ExportFile {
    name: String,
    data: Vec<u8>,
}

#[derive(serde::Deserialize)]
struct ExportFilesRequest {
    files: Vec<ExportFile>,
}

#[tauri::command]
fn export_files(
    app: AppHandle,
    state: State<'_, FileDialogState>,
    request: ExportFilesRequest,
) -> NativeResult<SavedPath> {
    if let Err(error) = validate_file_names(&request.files) {
        return NativeResult::failed(error);
    }
    let mut builder = app.dialog().file();
    if let Some(directory) = last_directory(&app, &state) {
        builder = builder.set_directory(directory);
    }
    let Some(selected) = builder
        .set_can_create_directories(true)
        .blocking_pick_folder()
    else {
        return NativeResult::canceled();
    };
    let Some(directory) = path_from_dialog(selected) else {
        return NativeResult::failed("The selected path is not a local directory");
    };

    if let Err(error) = fs::create_dir_all(&directory) {
        return NativeResult::failed(error.to_string());
    }
    for file in request.files {
        if let Err(error) = fs::write(directory.join(file.name), file.data) {
            return NativeResult::failed(error.to_string());
        }
    }
    remember_directory(&app, &state, &directory);
    NativeResult::success(SavedPath {
        path: directory.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        name: "MoldMaker".to_string(),
        version: app.package_info().version.to_string(),
        platform: if cfg!(target_os = "windows") {
            "win32"
        } else if cfg!(target_os = "macos") {
            "darwin"
        } else {
            "linux"
        },
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(FileDialogState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            open_step_file,
            open_project_file,
            save_project_file,
            export_files,
            app_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running MoldMaker");
}
