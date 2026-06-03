import path from "node:path";
import { Config } from "@remotion/cli/config";

/** Repo-root `assets/` — resolved from package cwd when CLI runs. */
Config.setPublicDir(path.resolve(process.cwd(), "../../assets"));
