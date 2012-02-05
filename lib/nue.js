var EventEmitter = require('events').EventEmitter; 
var sentinel = {};
var noOp = function () {};

exports.DEFAULT_BATCH_SIZE = 3;

exports.name = 'nue';

exports.version = '0.0.1';

exports.batchSize = exports.DEFAULT_BATCH_SIZE;

exports.start = function () {
  var args = Array.prototype.slice.apply(arguments);
  var callback;
  if (args.length === 0) {
    return;
  }
  callback = args.pop();
  callback.apply(null, args);
};

exports.queue = function () {
  var args = Array.prototype.slice.apply(arguments);
  return wrapOrApply(Nue.prototype.queue, args);
};

exports.flow = function () {
  var args = Array.prototype.slice.apply(arguments);
  return wrapOrApply(Nue.prototype.flow, args);
};

exports.each = function () {
  var args = Array.prototype.slice.apply(arguments);
  return wrapOrApply(Nue.prototype.each, args);
};

exports.parallelQueue = function () {
  var args = Array.prototype.slice.apply(arguments);
  return wrapOrApply(Nue.prototype.parallelQueue, args);
};

exports.parallel = function () {
  var args = Array.prototype.slice.apply(arguments);
  return wrapOrApply(Nue.prototype.parallel, args);
};

exports.parallelEach = function () {
  var args = Array.prototype.slice.apply(arguments);
  return wrapOrApply(Nue.prototype.parallelEach, args);
};

function wrapOrApply (fn, args) {
  var batchSize = exports.batchSize;
  if (typeof args[0] === 'number') {
    batchSize = args[0];
    return function () {
      var args = Array.prototype.slice.apply(arguments);
      return fn.apply(new Nue(batchSize), args)
    };
  }
  return fn.apply(new Nue(batchSize), args)
}

function Nue(batchSize) {
  this.batchSize = batchSize;
}

Nue.prototype.flow = function () {
  var tasks = Array.prototype.slice.apply(arguments);
  var batchSize = this.batchSize;
  var fn = function () {
    var args = Array.prototype.slice.apply(arguments);
    var self = this;
    runFlow(batchSize, tasks, fn, args, self.data);
  };
  Nue.eventify(fn);
  return fn;
};

Nue.prototype.each = function (begin, worker, end) {
  var batchSize = this.batchSize;
  var fn = function () {
    var args = Array.prototype.slice.apply(arguments);
    var self = this;
    new runEach(batchSize, begin, worker, end, args, self);
  };
  Nue.eventify(fn);
  return fn;
};

Nue.prototype.queue = function (worker, end) {
  return new Queue(this.batchSize, worker, end);
};

Nue.prototype.parallel = function (begin, tasks, end) {
  var args = Array.prototype.slice.apply(arguments);
  if (Array.isArray(args[0])) {
    begin = function () {
      this.fork();
    };
    tasks = args[0];
    end = typeof args[1] === 'function' ? args[1] : null;
  }
  var batchSize = this.batchSize;
  var fn = function () {
    var self = this;
    var args = Array.prototype.slice.apply(arguments);
    runParallel(batchSize, begin, tasks, end, args, self);
  };
  Nue.eventify(fn);
  return fn;
};

Nue.prototype.parallelEach = function (begin, worker, end) {
  var batchSize = this.batchSize;
  var fn = function () {
    var self = this;
    var args = Array.prototype.slice.apply(arguments);
    runParallelEach(batchSize, begin, worker, end, args, self);
  };
  Nue.eventify(fn);
  return fn;
};

Nue.prototype.parallelQueue = function (worker, end) {
  var begin = function () {
    this.fork();
  };
  return new ParallelQueue(this.batchSize, begin, worker, end);
};

Nue.eventify = function (fn) {
  fn.events = new EventEmitter();
  fn.on = function (type, handler) {
    if (type === 'done') {
      fn.events.on('done', function (context, args) {
        handler.apply(context, args);
      });
    }  };
  fn.once = function (type, handler) {
    if (type === 'done') {
      fn.events.once('done', function (context, args) {
        handler.apply(context, args);
      });
    }
  };
  fn.__nue__ = true;
};

function runFlow(batchSize, tasks, caller, callerArgs, data) {
  var begin;
  var end;
  var taskWrappers = tasks.map(function (task) {
    var fn;
    if (typeof task !== 'function') {
      throw new Error('not function');
    }
    if (task.__nue__) {
      return task;
    }
    fn = function () {
      return task.apply(this, Array.prototype.slice.apply(arguments));
    };
    Nue.eventify(fn);
    return fn;
  });
  taskWrappers.forEach(function (task, i, tasks) {
    var next = tasks[i + 1];
    if (i < tasks.length - 1) {
      if (task.__nue__) {
        task.events.once('__done__', function(flow) {
          flow.callback.call(null, next, flow);
        });
      }
    }
  });
  begin = taskWrappers[0];
  end = taskWrappers[taskWrappers.length - 1];
  end.events.on('__done__', function (flow) {
    caller.events.emit('__done__', flow);
    caller.events.emit('done', {data: flow.data}, flow.args);
  });

  executeTask(begin, {
    args: callerArgs,
    callback: executeTask,
    data: typeof data !== 'undefined' ? data : {},
    endCallback: end,
    batchSize: batchSize,
    callCount: 0
  });
}

function executeTask(task, flow) {
  flow.callCount++;
  var context = {
    data: flow.data,
    next: function () {
      context.next = noOp;
      flow.args = Array.prototype.slice.apply(arguments);
      flow.data = context.data;
      done(task.events, flow);
    },
    end: function () {
      var args = Array.prototype.slice.apply(arguments);
      var endContext = {
        data: context.data,
        next: function () {
          endContext.end = noOp;
          flow.args = Array.prototype.slice.apply(arguments);
          flow.data = endContext.data;
          done(flow.endCallback.events, flow);
        },
        end: noOp
      };
      flow.endCallback.apply(context, args);
    }
  };

  task.apply(context, flow.args);

  function done(emitter, flow) {
    if (flow.batchSize > 0 && flow.batchSize === flow.callCount) {
      flow.callCount = 0;
      process.nextTick(function () {
        emitter.emit('__done__', flow);
      });
    } else {
      emitter.emit('__done__', flow);
    }
  }
}

function runEach(batchSize, begin, worker, end, callerArgs, callerContext) {
  var valueIndex = 0;
  var valueLength = 0;
  var dataAvailable = callerContext && typeof callerContext.data !== 'undefined';
  var data = dataAvailable ? callerContext.data : {};
  var results = [];
  function executeEnd (err, results) {
    if (dataAvailable) {
      callerContext.data = data;
    }
    if (end) {
      end.call(callerContext, err, results);
    }
  }
  var context = {
    data: data,
    next: function () {
      var args = Array.prototype.slice.apply(arguments);
      var values;
      context.next = noOp;
      if (args.length === 1 && Array.isArray(args[0])) {
        values = args[0];
      } else {
        values = args;
      }
      valueLength = values.length;
      data = context.data;
      (function executeBatch () {
        var tasks = batchSize > 0 ? values.splice(0, batchSize) : values;
        if (tasks.length === 0) {
          executeEnd(null, results);
          return;
        }
        (function execute(task, tasks) {
          var context = {
            isFirst: valueIndex === 0,
            isLast: valueIndex === valueLength - 1,
            index: valueIndex,
            data: data,
            next: function () {
              var args = Array.prototype.slice.apply(arguments);
              context.next = noOp;
              data = context.data;
              if (args.length === 0) {
                results[valueIndex] = undefined;
              } else if (args.length === 1) {
                results[valueIndex] = args[0];
              } else {
                results[valueIndex] = args;
              }
              valueIndex++;
              if (tasks.length) {
                execute(tasks.shift(), tasks, args);
              } else {
                process.nextTick(function () {
                  executeBatch();
                });
              }
            },
            end: function () {
              var args = Array.prototype.slice.apply(arguments);
              context.end = noOp;
              executeEnd(args);
            }
          };
          worker.call(context, task);
        }(tasks.shift(), tasks));
      }());
    }
  };
  begin.apply(context, callerArgs);
}

function runParallel(batchSize, begin, tasks, end, callerArgs, callerContext) {
  var taskWrappers = tasks.map(function (task, i) {
    return { value:task, index:i };
  });
  var dataAvailable = callerContext && typeof callerContext.data !== 'undefined';
  var data = dataAvailable ? callerContext.data : {};
  var parallelArgs = [];
  var results = [];
  var taskCount = tasks.length;
  var isCanceled = false;
  var beginContext = {
    fork: function () {
      var args = Array.prototype.slice.apply(arguments);
      if (args.length === 1 && Array.isArray(args[0])) {
        parallelArgs = args[0]
      } else {
        parallelArgs = args;
      }
      beginContext.fork = noOp;
      process.nextTick(executeBatch);
    }
  };
  function executeEnd (err, results) {
    if (dataAvailable) {
      callerContext.data = data;
    }
    if (end) {
      end.call(callerContext, err, results);
    }
  }

  begin.apply(beginContext, callerArgs);
  
  function executeBatch () {
    var tasks;
    var task;
    var i;
    var len;
    var context;
    if (taskCount === 0) {
      executeEnd(null, results);
      return;
    }
    tasks = batchSize > 0 ? taskWrappers.splice(0, batchSize) : taskWrappers;
    len = tasks.length;
    for (i = 0; i < len; i++) {
      if (isCanceled) {
        break;
      }
      task = tasks[i];
      context = {};
      context.data = data;
      context.join = (function(index, context) {
        return function (result) {
          results[index] = result;
          taskCount--;
          context.join = noOp;
        };
      }(task.index, context));
      context.end = function () {
        var args = Array.prototype.slice.apply(arguments);
        isCanceled = true;
        executeEnd.apply(null, args);
      };
      task.value.call(context, parallelArgs[i]);
    }
    process.nextTick(executeBatch);
  }
}

function runParallelEach(batchSize, begin, worker, end, callerArgs, callerContext) {
  var context = {
    fork: function () {
      var args = Array.prototype.slice.apply(arguments);
      var values;
      var beginBridge;
      var tasks;
      context.fork = noOp;
      if (args.length === 1 && Array.isArray(args[0])) {
        values = args[0];
      } else {
        values = args;
      }
      beginBridge = function () {
        this.fork();
      };
      tasks = values.map(function (value) {
        return function () {
          worker.call(this, value);
        }
      });
      runParallel(batchSize, beginBridge, tasks, end, [], callerContext);
    }
  };
  begin.apply(context, callerArgs);
}

/**
 * 
 * @param batchSize
 * @param worker
 * @param end
 */
function Queue(batchSize, worker, end) {
  this.batchSize = batchSize;
  this.worker = worker;
  this.end = end || noOp;
  this.values = [];
  this.results = [];
  this.isAddingCompleted = false;
  this.isPushed = false;
  this.length = 0;
  this.index = 0;
  this.data = {};
}

Queue.prototype.push = function(value) {
  var self = this;
  if (this.isAddingCompleted) {
    throw new Error('This queue has been already frozen.');
  }
  this.values.push(value);
  self.length++;
  if (!this.isPushed) {
    this.isPushed = true;
    process.nextTick(function() {
      executeBatch();
    });
  }
  function executeBatch () {
    var values = self.batchSize > 0 ? self.values.splice(0, self.batchSize) : self.values;
    if (values.length === 0) {
      if (self.isAddingCompleted) {
        self.end.call({data: self.data}, null, self.results);
      } else {
        process.nextTick(function () {
          executeBatch();
        });
      }
      return;
    }
    (function execute(value, values) {
      var context = {
        index: self.index,
        isFirst: self.index === 0,
        isLast: self.isAddingCompleted && self.index === self.length - 1,
        data: self.data,
        next: function () {
          var args = Array.prototype.slice.apply(arguments);
          context.next = noOp;
          self.data = context.data;
          if (args.length === 0) {
            self.results[self.index] = undefined;
          } else if (args.length === 1) {
            self.results[self.index] = args[0];
          } else {
            self.results[self.index] = args;
          }
          self.index++;
          if (values.length) {
            execute(values.shift(), values);
          } else {
            process.nextTick(function () {
              executeBatch();
            });
          }
        },
        end: function () {
          var args = Array.prototype.slice.apply(arguments);
          var end = self.end;
          self.end = noOp;
          end.apply({data: context.data}, args);
        }
      };
      self.worker.call(context, value);
    }(values.shift(), values));
  }
};

Queue.prototype.complete = function() {
  this.isAddingCompleted = true;
};

/**
 *
 * @param batchSize
 * @param begin
 * @param worker
 * @param end
 */
function ParallelQueue(batchSize, begin, worker, end) {
  this.batchSize = batchSize;
  this.begin = begin;
  this.worker = worker;
  this.end = end || noOp;
  this.values = [];
  this.isAddingCompleted = false;
  this.isCanceled = false;
  this.isPushed = false;
  this.length = 0;
  this.taskCount = 0;
  this.results = [];
  this.args = [];
}

ParallelQueue.prototype.push = function (value) {
  var self = this;
  if (this.isAddingCompleted) {
    throw new Error('This queue has been already frozen.');
  }
  if (this.isCanceled) {
    return;
  }
  this.values.push({index : this.length, value: value});
  this.length++;
  this.taskCount++;
  if (!this.isPushed) {
    this.isPushed = true;
    (function () {
      var context = {
        fork: function () {
          self.args = Array.prototype.slice.apply(arguments);
          context.fork = noOp;
          process.nextTick(executeBatch);
        }
      };
      self.begin.apply(context);
    }());
  } else {
    process.nextTick(executeBatch);
  }
  function executeBatch() {
    var context;
    var values = self.values;
    var value;
    var i;
    for (i = 0; values.length && (self.batchSize > 0 && i < self.batchSize || self.batchSize < 0); i++) {
      if (self.isCanceled) {
        break;
      }
      value = values.shift();
      if (value.value === sentinel) {
        process.nextTick(function _end() {
          if (self.taskCount === 1) {
            self.end.call(null, null, self.results);
          } else {
            process.nextTick(_end);
          }
        });
        return;
      }
      context = {};
      context.index = value.index;
      context.join = (function(index, context) {
        return function (result) {
          self.results[index] = result;
          self.taskCount--;
          context.join = noOp;
        };
      }(value.index, context));
      context.end = function () {
        var args = Array.prototype.slice.apply(arguments);
        self.end.apply(null, args);
        self.end = noOp;
        self.isCanceled = true;
      };
      self.worker.call(context, value.value, self.args[value.index]);
    }
  }
};

ParallelQueue.prototype.complete = function() {
  this.push(sentinel);
  this.isAddingCompleted = true;
};
