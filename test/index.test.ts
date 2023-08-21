import { describe, expect, it } from "bun:test";
import { Elysia, HTTPMethod } from "elysia";
import { elysiaConnect, elysiaConnectDecorate } from "../src";
import { IncomingMessage, ServerResponse } from "node:http";
import { compose } from "compose-middleware";

describe("elysia-connect", () => {
    it("should handle basic Connect middlewares", async () => {
        const app = new Elysia()
            .use(elysiaConnectDecorate())
            .get("/test1", async () => "Test 1", {
                async beforeHandle(context) {
                    const resp = await context.elysiaConnect(
                        createNoOpMiddleware(),
                        context
                    );
                    if (resp) return resp;
                },
            })
            .get("/test2", async () => "Test 2", {
                async beforeHandle(context) {
                    const resp = await context.elysiaConnect(
                        createMiddleware({ body: "Middleware 2" }),
                        context
                    );
                    if (resp) return resp;
                },
            });

        await testPaths(app, {
            "/test1": "Test 1",
            "/test2": "Middleware 2",
        });
    });

    it("should handle statusCode & headers", async () => {
        const testMiddlewareOptions: CreateMiddlewareOptions = {
            body: "Middleware content",
            headers: { "content-type": "text/plain; charset=utf-8" },
            statusCode: 304, // intentionally not 200

            // @todo: it seems that statusMessage is eaten by Elysia?
            // statusMessage: 'Not Modified - Middleware'
        };

        const app = new Elysia()
            .use(elysiaConnectDecorate())
            .get("/", async () => "Hello world", {
                async beforeHandle(context) {
                    const resp = await context.elysiaConnect(
                        createMiddleware(testMiddlewareOptions),
                        context
                    );
                    if (resp) return resp;
                },
            });

        const resp = await app.handle(createReq("/")).then(async (r) => ({
            text: await r.text(),
            contentType: await r.headers.get("content-type"),
            statusCode: r.status,
            // statusMessage: r.statusText,
        }));

        expect(resp).toEqual({
            text: testMiddlewareOptions.body,
            contentType: testMiddlewareOptions.headers?.["content-type"],
            statusCode: testMiddlewareOptions.statusCode,
            // statusMessage: testMiddlewareOptions.statusMessage,
        });
    });

    it("should support path matching", async () => {
        const app = new Elysia()
            .use(
                elysiaConnect(createMiddleware({ body: "Hello middleware" }), {
                    matchPath: (path) => path === "/child",
                })
            )
            .get("/", async () => "Nothing here")
            .get("/child", async () => "Hello child");

        await testPaths(app, {
            "/": "Nothing here",
            "/child": "Hello middleware",
        });
    });

    it("should support any methods", async () => {
        const app = new Elysia()
            .use(
                elysiaConnect((req, res, next) => {
                    if (req.method?.toLowerCase() === "post") {
                        return res.end("post1");
                    }
                    next();
                })
            )
            .get("/get", async () => "get")
            .post("/post", async () => "post");
        await testPaths(
            app,
            {
                "/get": "get",
                "/post": "post1",
            },
            {
                "/post": { method: "POST" },
            }
        );
    });

    it("should work with child path", async () => {
        const app = new Elysia()
            .use(elysiaConnectDecorate())
            .get("/", async () => "Nothing here")
            .get("/child", async () => "Hello world", {
                async beforeHandle(context) {
                    const resp = await context.elysiaConnect(
                        createNoOpMiddleware(),
                        context
                    );
                    if (resp) return resp;
                },
            });

        await testPaths(app, {
            "/": "Nothing here",
            "/child": "Hello world",
        });
    });

    it("should support multiple Elysia middlewares", async () => {
        const middleware1 = createRespMiddleware((res, next) => {
            res.write("Hello");
            next();
        });
        const middleware2 = createRespMiddleware((res, next) => {
            res.end(" world");
        });
        const middleware3 = createRespMiddleware((res, next) => {
            res.end(". This should not be called");
        });

        // use name to bypass plugin deduplication
        const app = new Elysia()
            .use(elysiaConnect(middleware1, { name: "middleware1" }))
            .use(elysiaConnect(middleware2, { name: "middleware2" }))
            .use(elysiaConnect(middleware3, { name: "middleware3" }))
            .get("/", async () => "Should not be called");
        const text = await app.handle(createReq("/")).then((r) => r.text());
        expect(text).toBe("Hello world");
    });

    it("should support multiple Connect middlewares", async () => {
        const middleware1 = createRespMiddleware((res, next) => {
            res.write("Hello");
            next();
        });
        const middleware2 = createRespMiddleware((res, next) => {
            res.end(" Elysia");
        });
        const middlewares = compose([middleware1, middleware2]);
        const app = new Elysia()
            .use(elysiaConnect(middlewares))
            .get("/", async () => "Should not be called");
        const text = await app.handle(createReq("/")).then((r) => r.text());
        expect(text).toBe("Hello Elysia");
    });
});

type NextFn = (error?: Error) => void;
type ConnectMiddleware = (
    req: IncomingMessage,
    res: ServerResponse,
    next: NextFn
) => void;

// @see https://github.com/elysiajs/elysia/blob/main/test/utils.ts
function createReq(path: string, init?: RequestInit) {
    return new Request(`http://localhost${path}`, init);
}

function createNoOpMiddleware() {
    return (req: IncomingMessage, res: ServerResponse, next: NextFn) => next();
}

function createRespMiddleware(
    transformResponse: (res: ServerResponse, next: NextFn) => void
) {
    return (req: IncomingMessage, res: ServerResponse, next: NextFn) =>
        transformResponse(res, next);
}

type CreateMiddlewareOptions = {
    body: string;
    statusCode?: number;
    statusMessage?: string;
    headers?: Record<string, string>;
};

function createMiddleware({
    body,
    statusCode = 200,
    statusMessage = "OK",
    headers = { "Content-Type": "text/plain" },
}: CreateMiddlewareOptions) {
    return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        res.statusCode = statusCode;
        res.statusMessage = statusMessage;
        Object.entries(headers).forEach(([key, value]) =>
            res.setHeader(key, value)
        );
        res.end(body);
    };
}

async function testPaths<
    App extends Elysia<any>,
    Path extends string = string,
    Body extends string = string
>(
    app: App,
    expected: Record<Path, Body>,
    inits?: Partial<Record<Path, RequestInit>>
) {
    for (const [path, expectedText] of Object.entries(expected)) {
        const text = await app
            .handle(createReq(path, inits?.[path as Path]))
            .then((r) => r.text());
        expect(text).toBe(expectedText);
    }
}
