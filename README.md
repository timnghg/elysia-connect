# elysia-connect

Use Connect's middlewares with Elysia.

## Installation

```bash
bun add elysia-connect
``` 

## Usage

```js
const {Elysia} = require('elysia')
const {elysiaConnect} = require('elysia-connect/src')

const middleware1 = (req, res, next) => {
    res.write("Hello");
    next();
}

const middleware2 = (req, res, next) => {
    res.end(" world");
}

const middleware3 = (req, res, next) => {
    res.end("Xin chào");
}

const app = new Elysia()
    // 1. use as plugin
    .use(elysiaConnect(middleware1, {
        mathPath: (path) => path === '/hello' // optional path matcher
    }))
    .use(elysiaConnect(middleware2, {
        mathPath: (path) => path === '/hello' // optional path matcher
    }))

    // 2. use in hook beforeHandle
    .get('/hello1', () => {
        return "Helo";
    }, {
        async beforeHandle(context) {
            const resp = await context.elysiaConnect(middleware3, context);
            if (resp) return resp;
        }
    })
    .listen(3000);

// curl http://localhost:3000/hello -> Hello world
// curl http://localhost:3000/hello1 -> Xin chào
```