self.__SERVER_FILES_MANIFEST={
  "version": 1,
  "config": {
    "env": {
      "_sentryRewriteFramesDistDir": "/tmp/mtcpl-dist",
      "_sentryRewriteFramesAssetPrefixPath": "",
      "_sentryRelease": "7b36091d36b8516e45ac08e1ec366f67330c69c7"
    },
    "webpack": null,
    "typescript": {
      "ignoreBuildErrors": false
    },
    "typedRoutes": false,
    "distDir": "/tmp/mtcpl-dist",
    "cleanDistDir": true,
    "assetPrefix": "",
    "cacheMaxMemorySize": 52428800,
    "configOrigin": "next.config.ts",
    "useFileSystemPublicRoutes": true,
    "generateEtags": true,
    "pageExtensions": [
      "tsx",
      "ts",
      "jsx",
      "js"
    ],
    "poweredByHeader": true,
    "compress": true,
    "images": {
      "deviceSizes": [
        640,
        750,
        828,
        1080,
        1200,
        1920,
        2048,
        3840
      ],
      "imageSizes": [
        32,
        48,
        64,
        96,
        128,
        256,
        384
      ],
      "path": "/_next/image",
      "loader": "default",
      "loaderFile": "",
      "domains": [],
      "disableStaticImages": false,
      "minimumCacheTTL": 14400,
      "formats": [
        "image/webp"
      ],
      "maximumRedirects": 3,
      "maximumResponseBody": 50000000,
      "dangerouslyAllowLocalIP": false,
      "dangerouslyAllowSVG": false,
      "contentSecurityPolicy": "script-src 'none'; frame-src 'none'; sandbox;",
      "contentDispositionType": "attachment",
      "localPatterns": [
        {
          "pathname": "**",
          "search": ""
        }
      ],
      "remotePatterns": [],
      "qualities": [
        75
      ],
      "unoptimized": false,
      "customCacheHandler": false
    },
    "devIndicators": {
      "position": "bottom-left"
    },
    "onDemandEntries": {
      "maxInactiveAge": 60000,
      "pagesBufferLength": 5
    },
    "basePath": "",
    "sassOptions": {},
    "trailingSlash": false,
    "i18n": null,
    "productionBrowserSourceMaps": true,
    "excludeDefaultMomentLocales": true,
    "reactProductionProfiling": false,
    "reactStrictMode": true,
    "reactMaxHeadersLength": 6000,
    "httpAgentOptions": {
      "keepAlive": true
    },
    "logging": {
      "serverFunctions": true,
      "browserToTerminal": "warn"
    },
    "compiler": {},
    "expireTime": 31536000,
    "staticPageGenerationTimeout": 60,
    "modularizeImports": {
      "@mui/icons-material": {
        "transform": "@mui/icons-material/{{member}}"
      },
      "lodash": {
        "transform": "lodash/{{member}}"
      }
    },
    "outputFileTracingRoot": "/Users/home/Documents/DEVELOPMENT/mtcpl-cloud",
    "cacheComponents": false,
    "cacheLife": {
      "default": {
        "stale": 300,
        "revalidate": 900,
        "expire": 4294967294
      },
      "seconds": {
        "stale": 30,
        "revalidate": 1,
        "expire": 60
      },
      "minutes": {
        "stale": 300,
        "revalidate": 60,
        "expire": 3600
      },
      "hours": {
        "stale": 300,
        "revalidate": 3600,
        "expire": 86400
      },
      "days": {
        "stale": 300,
        "revalidate": 86400,
        "expire": 604800
      },
      "weeks": {
        "stale": 300,
        "revalidate": 604800,
        "expire": 2592000
      },
      "max": {
        "stale": 300,
        "revalidate": 2592000,
        "expire": 31536000
      }
    },
    "cacheHandlers": {},
    "experimental": {
      "appNewScrollHandler": false,
      "useSkewCookie": false,
      "cssChunking": true,
      "multiZoneDraftMode": false,
      "appNavFailHandling": false,
      "prerenderEarlyExit": true,
      "serverMinification": true,
      "linkNoTouchStart": false,
      "caseSensitiveRoutes": false,
      "cachedNavigations": false,
      "partialFallbacks": false,
      "dynamicOnHover": false,
      "varyParams": false,
      "prefetchInlining": false,
      "preloadEntriesOnStart": true,
      "clientRouterFilter": true,
      "clientRouterFilterRedirects": false,
      "fetchCacheKeyPrefix": "",
      "proxyPrefetch": "flexible",
      "optimisticClientCache": true,
      "manualClientBasePath": false,
      "cpus": 9,
      "memoryBasedWorkersCount": false,
      "imgOptConcurrency": null,
      "imgOptTimeoutInSeconds": 7,
      "imgOptMaxInputPixels": 268402689,
      "imgOptSequentialRead": null,
      "imgOptSkipMetadata": null,
      "isrFlushToDisk": true,
      "workerThreads": false,
      "optimizeCss": false,
      "nextScriptWorkers": false,
      "scrollRestoration": false,
      "externalDir": false,
      "disableOptimizedLoading": false,
      "gzipSize": true,
      "craCompat": false,
      "esmExternals": true,
      "fullySpecified": false,
      "swcTraceProfiling": false,
      "forceSwcTransforms": false,
      "largePageDataBytes": 128000,
      "typedEnv": false,
      "clientTraceMetadata": [
        "baggage",
        "sentry-trace"
      ],
      "parallelServerCompiles": false,
      "parallelServerBuildTraces": false,
      "ppr": false,
      "authInterrupts": false,
      "webpackMemoryOptimizations": false,
      "optimizeServerReact": true,
      "strictRouteTypes": false,
      "viewTransition": false,
      "removeUncaughtErrorAndRejectionListeners": false,
      "validateRSCRequestHeaders": false,
      "staleTimes": {
        "dynamic": 0,
        "static": 300
      },
      "reactDebugChannel": true,
      "serverComponentsHmrCache": true,
      "staticGenerationMaxConcurrency": 8,
      "staticGenerationMinPagesPerWorker": 25,
      "transitionIndicator": false,
      "gestureTransition": false,
      "inlineCss": false,
      "useCache": false,
      "globalNotFound": false,
      "browserDebugInfoInTerminal": "warn",
      "lockDistDir": true,
      "proxyClientMaxBodySize": 10485760,
      "hideLogsAfterAbort": false,
      "mcpServer": true,
      "turbopackFileSystemCacheForDev": true,
      "turbopackFileSystemCacheForBuild": false,
      "turbopackInferModuleSideEffects": true,
      "turbopackPluginRuntimeStrategy": "childProcesses",
      "serverActions": {
        "bodySizeLimit": "5mb"
      },
      "optimizePackageImports": [
        "lucide-react",
        "date-fns",
        "lodash-es",
        "ramda",
        "antd",
        "react-bootstrap",
        "ahooks",
        "@ant-design/icons",
        "@headlessui/react",
        "@headlessui-float/react",
        "@heroicons/react/20/solid",
        "@heroicons/react/24/solid",
        "@heroicons/react/24/outline",
        "@visx/visx",
        "@tremor/react",
        "rxjs",
        "@mui/material",
        "@mui/icons-material",
        "recharts",
        "react-use",
        "effect",
        "@effect/schema",
        "@effect/platform",
        "@effect/platform-node",
        "@effect/platform-browser",
        "@effect/platform-bun",
        "@effect/sql",
        "@effect/sql-mssql",
        "@effect/sql-mysql2",
        "@effect/sql-pg",
        "@effect/sql-sqlite-node",
        "@effect/sql-sqlite-bun",
        "@effect/sql-sqlite-wasm",
        "@effect/sql-sqlite-react-native",
        "@effect/rpc",
        "@effect/rpc-http",
        "@effect/typeclass",
        "@effect/experimental",
        "@effect/opentelemetry",
        "@material-ui/core",
        "@material-ui/icons",
        "@tabler/icons-react",
        "mui-core",
        "react-icons/ai",
        "react-icons/bi",
        "react-icons/bs",
        "react-icons/cg",
        "react-icons/ci",
        "react-icons/di",
        "react-icons/fa",
        "react-icons/fa6",
        "react-icons/fc",
        "react-icons/fi",
        "react-icons/gi",
        "react-icons/go",
        "react-icons/gr",
        "react-icons/hi",
        "react-icons/hi2",
        "react-icons/im",
        "react-icons/io",
        "react-icons/io5",
        "react-icons/lia",
        "react-icons/lib",
        "react-icons/lu",
        "react-icons/md",
        "react-icons/pi",
        "react-icons/ri",
        "react-icons/rx",
        "react-icons/si",
        "react-icons/sl",
        "react-icons/tb",
        "react-icons/tfi",
        "react-icons/ti",
        "react-icons/vsc",
        "react-icons/wi"
      ],
      "trustHostHeader": false,
      "isExperimentalCompile": false
    },
    "htmlLimitedBots": "[\\w-]+-Google|Google-[\\w-]+|Chrome-Lighthouse|Slurp|DuckDuckBot|baiduspider|yandex|sogou|bitlybot|tumblr|vkShare|quora link preview|redditbot|ia_archiver|Bingbot|BingPreview|applebot|facebookexternalhit|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|Yeti|googleweblight",
    "bundlePagesRouterDependencies": false,
    "configFileName": "next.config.ts",
    "serverExternalPackages": [
      "xlsx",
      "exceljs",
      "imapflow",
      "mailparser",
      "amqplib",
      "connect",
      "dataloader",
      "express",
      "generic-pool",
      "graphql",
      "@hapi/hapi",
      "ioredis",
      "kafkajs",
      "koa",
      "lru-memoizer",
      "mongodb",
      "mongoose",
      "mysql",
      "mysql2",
      "knex",
      "pg",
      "pg-pool",
      "@node-redis/client",
      "@redis/client",
      "redis",
      "tedious"
    ],
    "turbopack": {
      "debugIds": true,
      "rules": {
        "**/instrumentation-client.*": {
          "condition": {
            "not": "foreign"
          },
          "loaders": [
            {
              "loader": "/Users/home/Documents/DEVELOPMENT/mtcpl-cloud/node_modules/@sentry/nextjs/build/cjs/config/loaders/valueInjectionLoader.js",
              "options": {
                "values": {
                  "_sentryRouteManifest": "{\"dynamicRoutes\":[{\"path\":\"/accounts/advances/:id\",\"regex\":\"^/accounts/advances/([^/]+)$\",\"paramNames\":[\"id\"],\"hasOptionalPrefix\":false},{\"path\":\"/accounts/bills/:id\",\"regex\":\"^/accounts/bills/([^/]+)$\",\"paramNames\":[\"id\"],\"hasOptionalPrefix\":false},{\"path\":\"/accounts/bills/:id/edit\",\"regex\":\"^/accounts/bills/([^/]+)/edit$\",\"paramNames\":[\"id\"],\"hasOptionalPrefix\":false},{\"path\":\"/accounts/final-audit/flagged/:paymentId/settle\",\"regex\":\"^/accounts/final-audit/flagged/([^/]+)/settle$\",\"paramNames\":[\"paymentId\"],\"hasOptionalPrefix\":false},{\"path\":\"/accounts/payments/:id/voucher\",\"regex\":\"^/accounts/payments/([^/]+)/voucher$\",\"paramNames\":[\"id\"],\"hasOptionalPrefix\":false},{\"path\":\"/accounts/vendors/:id\",\"regex\":\"^/accounts/vendors/([^/]+)$\",\"paramNames\":[\"id\"],\"hasOptionalPrefix\":false},{\"path\":\"/activity-register/:siteId\",\"regex\":\"^/activity-register/([^/]+)$\",\"paramNames\":[\"siteId\"],\"hasOptionalPrefix\":false},{\"path\":\"/carving/:id\",\"regex\":\"^/carving/([^/]+)$\",\"paramNames\":[\"id\"],\"hasOptionalPrefix\":false},{\"path\":\"/carving/challans/:id\",\"regex\":\"^/carving/challans/([^/]+)$\",\"paramNames\":[\"id\"],\"hasOptionalPrefix\":false},{\"path\":\"/carving/vendors/:id\",\"regex\":\"^/carving/vendors/([^/]+)$\",\"paramNames\":[\"id\"],\"hasOptionalPrefix\":false},{\"path\":\"/carving/work-orders/:id\",\"regex\":\"^/carving/work-orders/([^/]+)$\",\"paramNames\":[\"id\"],\"hasOptionalPrefix\":false},{\"path\":\"/cutting/:id\",\"regex\":\"^/cutting/([^/]+)$\",\"paramNames\":[\"id\"],\"hasOptionalPrefix\":false},{\"path\":\"/invoicing/:id\",\"regex\":\"^/invoicing/([^/]+)$\",\"paramNames\":[\"id\"],\"hasOptionalPrefix\":false},{\"path\":\"/invoicing/challans/:id\",\"regex\":\"^/invoicing/challans/([^/]+)$\",\"paramNames\":[\"id\"],\"hasOptionalPrefix\":false},{\"path\":\"/invoicing/challans/:id/convert\",\"regex\":\"^/invoicing/challans/([^/]+)/convert$\",\"paramNames\":[\"id\"],\"hasOptionalPrefix\":false},{\"path\":\"/invoicing/invoices/:id\",\"regex\":\"^/invoicing/invoices/([^/]+)$\",\"paramNames\":[\"id\"],\"hasOptionalPrefix\":false},{\"path\":\"/invoicing/parties/:id\",\"regex\":\"^/invoicing/parties/([^/]+)$\",\"paramNames\":[\"id\"],\"hasOptionalPrefix\":false},{\"path\":\"/maintenance/:id\",\"regex\":\"^/maintenance/([^/]+)$\",\"paramNames\":[\"id\"],\"hasOptionalPrefix\":false},{\"path\":\"/site/:temple\",\"regex\":\"^/site/([^/]+)$\",\"paramNames\":[\"temple\"],\"hasOptionalPrefix\":false},{\"path\":\"/site/:temple/install\",\"regex\":\"^/site/([^/]+)/install$\",\"paramNames\":[\"temple\"],\"hasOptionalPrefix\":false},{\"path\":\"/site/:temple/stock\",\"regex\":\"^/site/([^/]+)/stock$\",\"paramNames\":[\"temple\"],\"hasOptionalPrefix\":false},{\"path\":\"/vendor/:id\",\"regex\":\"^/vendor/([^/]+)$\",\"paramNames\":[\"id\"],\"hasOptionalPrefix\":false},{\"path\":\"/cutting/:id/labels\",\"regex\":\"^/cutting/([^/]+)/labels$\",\"paramNames\":[\"id\"],\"hasOptionalPrefix\":false},{\"path\":\"/cutting/:id/print\",\"regex\":\"^/cutting/([^/]+)/print$\",\"paramNames\":[\"id\"],\"hasOptionalPrefix\":false},{\"path\":\"/dispatch/:id/print\",\"regex\":\"^/dispatch/([^/]+)/print$\",\"paramNames\":[\"id\"],\"hasOptionalPrefix\":false}],\"staticRoutes\":[{\"path\":\"/\"},{\"path\":\"/accounts\"},{\"path\":\"/accounts/advances\"},{\"path\":\"/accounts/advances/new\"},{\"path\":\"/accounts/approvals\"},{\"path\":\"/accounts/bank-declines\"},{\"path\":\"/accounts/bills\"},{\"path\":\"/accounts/bills/new\"},{\"path\":\"/accounts/bills/scan-multi\"},{\"path\":\"/accounts/final-audit\"},{\"path\":\"/accounts/final-audit/flagged\"},{\"path\":\"/accounts/final-audit/verified\"},{\"path\":\"/accounts/pay-today\"},{\"path\":\"/accounts/payments\"},{\"path\":\"/accounts/reconcile\"},{\"path\":\"/accounts/royalty-approvals\"},{\"path\":\"/accounts/royalty-summary\"},{\"path\":\"/accounts/vendors\"},{\"path\":\"/activity-register\"},{\"path\":\"/ask-ai\"},{\"path\":\"/audit\"},{\"path\":\"/block-journey\"},{\"path\":\"/blocks\"},{\"path\":\"/blocks/purchase\"},{\"path\":\"/blocks/report\"},{\"path\":\"/carving\"},{\"path\":\"/carving/challans\"},{\"path\":\"/carving/challans/new\"},{\"path\":\"/carving/expenses\"},{\"path\":\"/carving/floor\"},{\"path\":\"/carving/rejected\"},{\"path\":\"/carving/reports\"},{\"path\":\"/carving/storage\"},{\"path\":\"/carving/transfer\"},{\"path\":\"/carving/vendors\"},{\"path\":\"/carving/work-orders\"},{\"path\":\"/carving/work-orders/new\"},{\"path\":\"/challan\"},{\"path\":\"/cutting\"},{\"path\":\"/cutting/approvals\"},{\"path\":\"/cutting/expenses\"},{\"path\":\"/dashboard\"},{\"path\":\"/dashboard/emails\"},{\"path\":\"/dashboard/push-urgent\"},{\"path\":\"/dispatch\"},{\"path\":\"/dispatch/rework\"},{\"path\":\"/inventory\"},{\"path\":\"/inventory/approvals\"},{\"path\":\"/inventory/scaffolding\"},{\"path\":\"/inventory/scaffolding/components\"},{\"path\":\"/inventory/scaffolding/history\"},{\"path\":\"/inventory/scaffolding/issue\"},{\"path\":\"/inventory/scaffolding/move-yard\"},{\"path\":\"/inventory/scaffolding/receive\"},{\"path\":\"/inventory/scaffolding/return\"},{\"path\":\"/inventory/scaffolding/sites\"},{\"path\":\"/inventory/scaffolding/writeoff\"},{\"path\":\"/invoicing\"},{\"path\":\"/invoicing/challans\"},{\"path\":\"/invoicing/challans/new\"},{\"path\":\"/invoicing/invoices\"},{\"path\":\"/invoicing/invoices/new\"},{\"path\":\"/invoicing/new\"},{\"path\":\"/invoicing/parties\"},{\"path\":\"/invoicing/work-order-doc\"},{\"path\":\"/maintenance\"},{\"path\":\"/maintenance/tickets\"},{\"path\":\"/planning\"},{\"path\":\"/profile\"},{\"path\":\"/reports/various-costing\"},{\"path\":\"/reports/various-costing/cnc\"},{\"path\":\"/reports/various-costing/cutter\"},{\"path\":\"/settings\"},{\"path\":\"/site\"},{\"path\":\"/slabs\"},{\"path\":\"/slabs/import\"},{\"path\":\"/slabs/ready\"},{\"path\":\"/slabs/ready/for-carving\"},{\"path\":\"/slabs/view\"},{\"path\":\"/tasks\"},{\"path\":\"/tasks/owner-reviews\"},{\"path\":\"/tasks/slab-cancels\"},{\"path\":\"/tasks/slab-imports\"},{\"path\":\"/temples\"},{\"path\":\"/vendor\"},{\"path\":\"/cutting/list-print\"},{\"path\":\"/embed/block-journey\"},{\"path\":\"/embed/blocks/report\"},{\"path\":\"/embed/slabs/ready\"},{\"path\":\"/login\"},{\"path\":\"/pending\"}],\"isrRoutes\":[]}",
                  "_sentryNextJsVersion": "16.2.2"
                }
              }
            }
          ]
        },
        "**/instrumentation.*": {
          "condition": {
            "not": "foreign"
          },
          "loaders": [
            {
              "loader": "/Users/home/Documents/DEVELOPMENT/mtcpl-cloud/node_modules/@sentry/nextjs/build/cjs/config/loaders/valueInjectionLoader.js",
              "options": {
                "values": {
                  "__SENTRY_SERVER_MODULES__": {
                    "@anthropic-ai/sdk": "^0.89.0",
                    "@sentry/nextjs": "^10.49.0",
                    "@supabase/ssr": "latest",
                    "@supabase/supabase-js": "latest",
                    "exceljs": "^4.4.0",
                    "framer-motion": "^12.38.0",
                    "imapflow": "^1.4.0",
                    "mailparser": "^3.9.9",
                    "next": "latest",
                    "pdf-lib": "^1.17.1",
                    "react": "latest",
                    "react-dom": "latest",
                    "react-markdown": "^10.1.0",
                    "remark-gfm": "^4.0.1",
                    "xlsx": "^0.18.5",
                    "xlsx-js-style": "^1.2.0",
                    "@types/mailparser": "^3.4.6",
                    "@types/node": "latest",
                    "@types/react": "latest",
                    "@types/react-dom": "latest",
                    "typescript": "latest"
                  },
                  "_sentryNextJsVersion": "16.2.2"
                }
              }
            }
          ]
        }
      },
      "root": "/Users/home/Documents/DEVELOPMENT/mtcpl-cloud"
    },
    "distDirRoot": "/tmp/mtcpl-dist"
  },
  "appDir": "/Users/home/Documents/DEVELOPMENT/mtcpl-cloud",
  "relativeAppDir": "",
  "files": [
    "/tmp/mtcpl-dist/routes-manifest.json",
    "/tmp/mtcpl-dist/server/pages-manifest.json",
    "/tmp/mtcpl-dist/build-manifest.json",
    "/tmp/mtcpl-dist/prerender-manifest.json",
    "/tmp/mtcpl-dist/server/functions-config-manifest.json",
    "/tmp/mtcpl-dist/server/middleware-manifest.json",
    "/tmp/mtcpl-dist/server/middleware-build-manifest.js",
    "/tmp/mtcpl-dist/server/app-paths-manifest.json",
    "/tmp/mtcpl-dist/app-path-routes-manifest.json",
    "/tmp/mtcpl-dist/server/server-reference-manifest.js",
    "/tmp/mtcpl-dist/server/server-reference-manifest.json",
    "/tmp/mtcpl-dist/server/prefetch-hints.json",
    "/tmp/mtcpl-dist/BUILD_ID",
    "/tmp/mtcpl-dist/server/next-font-manifest.js",
    "/tmp/mtcpl-dist/server/next-font-manifest.json",
    "/tmp/mtcpl-dist/required-server-files.json"
  ],
  "ignore": []
}