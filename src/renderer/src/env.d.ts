/// <reference types="vite/client" />

import type { MoldMakerApi } from "../../shared/electron-api";

declare global {
  interface Window {
    moldMaker: MoldMakerApi;
  }
}

export {};
