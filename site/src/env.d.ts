// Build constants. site/astro.config.mjs sets them with vite.define.

/** Build time in seconds since 1970-01-01 UTC. Same value as `time` in /version.json. */
declare const __BUILD_TIME__: number;
/** Short git commit of the build, or 'unknown'. */
declare const __BUILD_COMMIT__: string;
