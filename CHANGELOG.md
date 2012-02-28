# Changelog

 - 0.4.0 (2012/02/27)
   - New Feature - `nue.parallel` is available to execute some steps in parallel.
   - New Feature - in a step function, `this.forEach` function is available to execute a provided function once per array element in parallel.
   - New Feature - in a step function, `this.exec` function is available to execute a step asynchronously.
   - New Feature - in a step function, `this.history` property is available to contain information about executed steps (EXPERIMENTAL).

 - 0.3.0 (2012/02/25)
   - New Feature - in a step function, `this.endWith` is available to end a control-flow with an error.
   - Change - `arguments` for an async callback are grouped by each `this.async` call. 

 - 0.2.0 (2012/02/23)
   - New Feature - an error passed to async callback is notified with NueAsyncError to make debug easy
   - New Feature - an unhandled error is notified with NueUnhandledError to make debug easy
   - New Feature - supported to name a flow
   - New Feature - in a step function, `this.flowName` is available.
   - New Feature - in a step function, `this.stepName` is available.
   - Change - in a step function, `this.end` doesn't accept an error object as first argument. To end a flow with an error, `throw` the error.

 - 0.1.0 (2012/02/21)
   - first release.