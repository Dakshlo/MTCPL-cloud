;!function(){try { var e="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof global?global:"undefined"!=typeof window?window:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&((e._debugIds|| (e._debugIds={}))[n]="25c65ec1-5ca7-a81d-c603-9abc8e70218d")}catch(e){}}();
module.exports=[670697,e=>{"use strict";var t=e.i(244018);let r=process.env.NEXT_PUBLIC_SENTRY_DSN;r&&t.init({dsn:r,environment:process.env.VERCEL_ENV??"production"??"development",tracesSampleRate:.1,beforeSend(e){if(e.extra)for(let t of Object.keys(e.extra)){let r=e.extra[t];"string"==typeof r&&/eyJ[A-Za-z0-9_.-]{40,}/.test(r)&&(e.extra[t]="[REDACTED_JWT]")}return e}}),e.s([])}];

//# debugId=25c65ec1-5ca7-a81d-c603-9abc8e70218d
//# sourceMappingURL=sentry_server_config_ts_0n88nqa._.js.map