import { Context, Elysia, ElysiaConfig } from "elysia";
import { IncomingMessage, ServerResponse } from "node:http";

export type ConnectMiddleware = (
    req: IncomingMessage,
    res: ServerResponse,
    callback: (...args: unknown[]) => void
) => void;

export type Options<C extends Context> = {
    name?: string;
    transformUrl?(url: string): string;
    match?(context: C): Promise<boolean> | boolean;
    matchUrl?(url: string): Promise<boolean> | boolean;
    matchPath?(url: string): Promise<boolean> | boolean;
};

export function elysiaConnectDecorate(options?: ElysiaConfig) {
    return new Elysia({
        name: "elysia-connect-decorate",
        ...options,
    }).decorate("elysiaConnect", transform);
}

export function elysiaConnect<C extends Context>(
    middleware: ConnectMiddleware,
    options?: Options<C>
) {
    const name = `elysia-connect${options?.name ? `-${options.name}` : ""}`;
    const seed = options || { name };
    return new Elysia({
        name,
        seed,
    })
        .use(
            elysiaConnectDecorate({
                name: `${name}-decorate`,
                seed,
            })
        )
        .derive((context) => ({
            pendingResponse: ElysiaServerResponse.fromRequest(
                ElysiaIncomingMessage.fromRequest(context.request)
            ),
        }))
        .use((app) =>
            app.onBeforeHandle(async (context) => {
                if (
                    options?.match &&
                    !(await options.match(context as unknown as C))
                )
                    return;
                if (
                    options?.matchUrl &&
                    !(await options.matchUrl(context.request.url))
                )
                    return;
                if (
                    options?.matchPath &&
                    !(await options.matchPath(
                        new URL(context.request.url).pathname
                    ))
                )
                    return;
                const resp = await context.elysiaConnect(
                    middleware,
                    context,
                    options as unknown as Options<Context>
                );
                if (!resp) return;
                return resp;
            })
        );
}

async function transform<
    C extends Context & { pendingResponse?: ElysiaServerResponse }
>(middleware: ConnectMiddleware, context: C, options?: Options<C>) {
    context.pendingResponse =
        context.pendingResponse ||
        ElysiaServerResponse.fromRequest(
            ElysiaIncomingMessage.fromRequest(context.request, options)
        );
    const nodeRequest = context.pendingResponse.req;

    return new Promise((resolve) => {
        const nodeResponse = context.pendingResponse;

        if (!nodeResponse) return resolve(undefined);

        nodeResponse.reply = (_resp: Response) => {
            const resp = new Response(_resp.body, {
                status: nodeResponse.statusCode,
                statusText: nodeResponse.statusMessage,
                headers: nodeResponse.getHeaders() as HeadersInit,
            });
            resolve(resp);
        };

        return middleware(nodeRequest, nodeResponse, () => {
            resolve(undefined);
        });
    });
}

class ElysiaIncomingMessage extends IncomingMessage {
    originalUrl?: string;
    originalRequest?: Request;

    static fromRequest<C extends Context>(
        request: Request,
        options?: Options<C>
    ) {
        let originalUrl = request.url;
        let url = request.url;
        if (options?.transformUrl) {
            url = options.transformUrl(request.url);
        }

        // @todo: figure correct TS type for this
        const message = new ElysiaIncomingMessage({
            method: request.method,
            headers: request.headers as Record<string, any>,
            url,
            body: request.body,
        } as any);

        message.originalUrl = originalUrl;
        message.originalRequest = request;
        return message;
    }
}

class ElysiaServerResponse extends ServerResponse {
    declare req: ElysiaIncomingMessage;
    reply?: (resp: Response) => void;

    constructor(options: {
        req: ElysiaIncomingMessage;
        reply?: (resp: Response) => void;
    }) {
        super(options as any);
    }

    static fromRequest(
        request: ElysiaIncomingMessage,
        reply?: (resp: Response) => void
    ) {
        return new ElysiaServerResponse({
            req: request,
            reply(resp: Response) {
                return this.reply ? this.reply(resp) : reply?.(resp);
            },
        });
    }
}
