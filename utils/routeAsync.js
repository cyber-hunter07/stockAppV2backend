// Express 4 does not forward rejected async route promises to error middleware.
function bindAsyncRoutes(router) {
  for (const method of ["get", "post", "put", "patch", "delete", "options", "head"]) {
    const register = router[method].bind(router);
    router[method] = (path, ...handlers) => register(path, ...handlers.map((handler) => {
      if (typeof handler !== "function" || handler.length === 4 || handler.constructor.name !== "AsyncFunction") return handler;
      return function asyncRoute(req, res, next) {
        Promise.resolve(handler(req, res, next)).catch(next);
      };
    }));
  }
  return router;
}

module.exports = { bindAsyncRoutes };
