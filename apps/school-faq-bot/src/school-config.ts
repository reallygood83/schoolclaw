import schoolConfigJson from "../school-config.json";
import type { SchoolConfig } from "./types.js";

export const schoolConfig = schoolConfigJson as SchoolConfig;
