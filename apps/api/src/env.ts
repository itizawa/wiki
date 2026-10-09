import type { AppConfig } from "./config";
import type { Db } from "./db/client";
import type { GoogleOidc } from "./auth/google";

export type Deps = {
  db: Db;
  config: AppConfig;
  google: GoogleOidc | null;
};

export type AppEnv = {
  Variables: {
    deps: Deps;
    adminEmail: string;
  };
};
