var EventEmitter = require('events').EventEmitter; 
var util = require('util');
var sentinel = {};

exports.DEFAULT_BATCH_SIZE = 3;

exports.name = 'nue';

exports.version = '0.0.3';

exports.batchSize = exports.DEFAULT_BATCH_SIZE;

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
  if (typeof args[0] === 'number') {
    return function () {
      return fn.apply(new Nue(args[0]), arguments)
    };
  }
  return fn.apply(new Nue(null), args)
}

function Nue(batchSize) {
  this.batchSize = batchSize;
}

Nue.prototype.flow = function () {
  var tasks = Array.prototype.slice.apply(arguments);
  var batchSize = this.batchSize;
  var fn = function () {
    var args = Array.prototype.slice.apply(arguments);
    runFlow(batchSize, tasks, fn, args, this);
  };
  Nue.attachEmitter(fn);
  return fn;
};

Nue.prototype.each = function (worker) {
  var batchSize = this.batchSize;
  if (typeof worker !== 'function') {
    throw new Error('The worker must be a function.');
  }
  var fn = function () {
    var args = Array.prototype.slice.apply(arguments);
    runEach(batchSize, worker, args, this);
  };
  Nue.attachEmitter(fn);
  return fn;
};

Nue.prototype.parallel = function () {
  var batchSize = this.batchSize;
  var tasks = arguments.length === 1 && Array.isArray(arguments[0])
    ? arguments[0]
    : Array.prototype.slice.apply(arguments);
   var fn = function () {
    var args = Array.prototype.slice.apply(arguments);
    runParallel(batchSize, tasks, args, this);
  };
  Nue.attachEmitter(fn);
  return fn;
};

Nue.prototype.parallelEach = function (worker) {
  var batchSize = this.batchSize;
  if (typeof worker !== 'function') {
    throw new Error('The worker must be a function.');
  }
  var fn = function () {
    var args = Array.prototype.slice.apply(arguments);
    runParallelEach(batchSize, worker, args, this);
  };
  Nue.attachEmitter(fn);
  return fn;
};

Nue.attachEmitter = function (fn) {
  fn.events = new EventEmitter();
  fn.on = function (type, handler) {
    if (type === 'done') {
      fn.events.on('done', function (context, args) {
        handler.apply(context, args);
      });
    }
    return fn;
  };
  fn.once = function (type, handler) {
    if (type === 'done') {
      fn.events.once('done', function (context, args) {
        handler.apply(context, args);
      });
    }
    return fn;
  };
  fn.__nue__ = true;
};

function ContextBase() {
  this.queue = this.queue.bind(this);
  this.parallelQueue = this.parallelQueue.bind(this);
}

ContextBase.prototype.queue = function (worker) {
  var self = this;
  var batchSize = arguments[0];
  if (typeof batchSize === 'number') {
    return function (worker) {
      return new Queue(batchSize, worker, self)
    };
  }
  return new Queue(this.batchSize, worker, self);
};

ContextBase.prototype.parallelQueue = function (worker) {
  var self = this;
  var batchSize = arguments[0];
  if (typeof batchSize === 'number') {
    return function (worker) {
      return new ParallelQueue(batchSize, worker, self)
    };
  }
  return new ParallelQueue(this.batchSize, worker, self);
};

function runFlow(batchSize, tasks, caller, callerArgs, callerContext) {
  
  function StepContext(step, flow) {
    ContextBase.call(this);
    this.step = step;
    this.flow = flow;
    this.batchSize = flow.batchSize;
    this.data = flow.data;
    this.err = flow.err;
    this.next = this.next.bind(this);
    this.end = this.end.bind(this);
    this.callback = this.callback.bind(this);
  }
  
  util.inherits(StepContext, ContextBase);

  StepContext.prototype.next = function () {
    this.flow.args = Array.prototype.slice.call(arguments);
    this.flow.err = this.err;
    this.flow.data = this.data;
    endStep(this.step.events, this.flow);
  };

  StepContext.prototype.end = function () {
    this.flow.args = Array.prototype.slice.call(arguments, 1);
    this.flow.err = arguments[0];
    this.flow.data = this.data;
    this.flow.lastStep.apply(new LastStepContext(this.step, this.flow), this.flow.args);
  };

  StepContext.prototype.callback = function () {
    if (arguments[0]) {
      this.end.apply(this, arguments);
    } else {
      this.next.apply(this, Array.prototype.slice.call(arguments, 1));
    }
  };
  
  function LastStepContext(step, flow) {
    ContextBase.call(this);
    this.step = step;
    this.flow = flow;
    this.batchSize = flow.batchSize;
    this.data = flow.data;
    this.err = flow.err;
    this.next = this.next.bind(this);
  }

  util.inherits(LastStepContext, ContextBase);

  LastStepContext.prototype.next = function () {
    if (this.err) {
      throw new Error('An error is not handled. ' +
        'To avoid this behavior, add the statement. "this.err = null;"\n' +
        'The unhandled error is following:\n' + 
        this.err.stack);
    }
    this.flow.args = Array.prototype.slice.call(arguments);
    this.flow.err = this.err;
    this.flow.data = this.data;
    endStep(this.flow.lastStep.events, this.flow);
  };

  function endStep(emitter, flow) {
    if (flow.batchSize > 0 && flow.batchSize === flow.callCount) {
      flow.callCount = 0;
      process.nextTick(function () {
        emitter.emit('__done__', flow);
      });
    } else {
      emitter.emit('__done__', flow);
    }
  }

  function startStep(step, flow) {
    flow.callCount++;
    step.apply(new StepContext(step, flow), flow.args);
  }

  function makeSteps(tasks) {
    var steps = tasks.map(function (task) {
      var fn;
      if (typeof task !== 'function') {
        throw new Error('not function');
      }
      if (task.__nue__) {
        return task;
      }
      fn = function () {
        return task.apply(this, arguments);
      };
      Nue.attachEmitter(fn);
      return fn;
    });
    var len = steps.length;
    steps.forEach(function (step, i, steps) {
      var next = steps[i + 1];
      if (i < len - 1) {
        if (step.__nue__) {
          step.events.once('__done__', function(flow) {
            startStep(next, flow);
          });
        }
      }
    });
    if (steps.length === 0) {
      steps.push(function () {
        this.next();
      });
      Nue.attachEmitter(steps[0]);
    }
    return steps;
  }
  
  function startFlow(batchSize) {
    var inFlow = callerContext instanceof ContextBase;
    var steps = makeSteps(tasks);
    var firstStep = steps[0];
    var lastStep = steps[steps.length - 1];
    lastStep.events.once('__done__', function (flow) {
      caller.events.emit('__done__', flow);
      caller.events.emit('done', {data: flow.data}, flow.args);
    });
    startStep(firstStep, {
      args: callerArgs,
      err: undefined,
      data: inFlow ? callerContext.data : {},
      lastStep: lastStep,
      batchSize: batchSize || (inFlow && callerContext.batchSize) || exports.batchSize,
      callCount: 0
    });
  }

  startFlow(batchSize);
}

function runEach(batchSize, worker, callerArgs, callerContext) {
  if (!(callerContext instanceof ContextBase)) {
    throw new Error('The context of the each function is illegal. The function is out of the flow.');
  }
  
  var index = 0;
  var length = 0;
  var values;
  var results = [];

  batchSize = batchSize || callerContext.batchSize || exports.batchSize;
  if (!batchSize) {
    throw new Error('illegal batch size');
  }

  function EachContext(values, index, batchSize, data) {
    ContextBase.call(this);
    this.values = values;
    this.index = index;
    this.batchSize = batchSize;
    this.data = data;
    this.isFirst = index === 0;
    this.isLast = index === length - 1;
    this.next = this.next.bind(this);
    this.end = this.end.bind(this);
    this.callback = this.callback.bind(this);
  }

  util.inherits(EachContext, ContextBase);

  EachContext.prototype.next = function (result) {
    results[index] = result;
    index++;
    callerContext.data = this.data;
    if (this.values.length) {
      runWorker(this.values.shift(), this.values);
    } else {
      process.nextTick(processValues);
    }
  };

  EachContext.prototype.end = function () {
    callerContext.err = arguments[0];
    callerContext.data = this.data;
    endEach.apply(null, Array.prototype.slice.call(arguments, 1));
  };

  EachContext.prototype.callback = function () {
    if (arguments[0]) {
      this.end.apply(this, arguments);
    } else {
      this.next.apply(this, Array.prototype.slice.call(arguments, 1));
    }
  };

  function endEach() {
    callerContext.next.apply(callerContext, Array.prototype.slice.apply(arguments));
  }

  function runWorker(value, values) {
    worker.call(new EachContext(values, index, batchSize, callerContext.data), value);
  }

  function processValues() {
    var batch = batchSize > 0 ? values.splice(0, batchSize) : values;
    if (batch.length) {
      runWorker(batch.shift(), batch);
    } else {
      endEach(results);
    }
  }

  function startEach() {
    if (callerArgs.length === 1 && Array.isArray(callerArgs[0])) {
      values = callerArgs[0];
    } else {
      values = callerArgs;
    }
    length = values.length;
    processValues();
  }

  startEach();
}

function runParallel(batchSize, tasks, callerArgs, callerContext) {
  if (!(callerContext instanceof ContextBase)) {
    throw new Error('The context of the parallel function is illegal. The function is out of the flow.');
  }

  var taskWrappers = tasks.map(function (task, i) {
    return { value:task, index:i };
  });
  var parallelArgs = [];
  var results = [];
  var taskCount = tasks.length;
  var isCanceled = false;

  batchSize = batchSize || callerContext.batchSize || exports.batchSize;
  if (!batchSize) {
    throw new Error('illegal batch size');
  }

  function ParallelContext(batchSize, data, index) {
    ContextBase.call(this);
    this.batchSize = batchSize;
    this.data = data;
    this.index = index;
    this.next = this.next.bind(this);
    this.end = this.end.bind(this);
    this.callback = this.callback.bind(this);
  }

  util.inherits(ParallelContext, ContextBase);

  ParallelContext.prototype.next = function (result) {
    callerContext.data = this.data;
    results[this.index] = result;
    taskCount--;
  };

  ParallelContext.prototype.end = function () {
    callerContext.err = arguments[0];
    callerContext.data = this.data;
    isCanceled = true;
    endParallel.apply(null, Array.prototype.slice.call(arguments, 1));
  };

  ParallelContext.prototype.callback = function (err, result) {
    if (arguments[0]) {
      this.end.apply(this, arguments);
    } else {
      this.next.apply(this, Array.prototype.slice.call(arguments, 1));
    }
  };

  function endParallel() {
    callerContext.next.apply(callerContext, Array.prototype.slice.apply(arguments));
  }

  function processTasks () {
    var tasks;
    var task;
    var i;
    var len;
    if (taskCount === 0) {
      endParallel(results);
    } else {
      tasks = batchSize > 0 ? taskWrappers.splice(0, batchSize) : taskWrappers;
      len = tasks.length;
      for (i = 0; i < len; i++) {
        if (isCanceled) {
          break;
        }
        task = tasks[i];
        task.value.call(new ParallelContext(batchSize, callerContext.data, task.index), parallelArgs[i]);
      }
      process.nextTick(processTasks);
    }
  }

  function startParallel() {
    if (callerArgs.length === 1 && Array.isArray(callerArgs[0])) {
      parallelArgs = callerArgs[0]
    } else {
      parallelArgs = callerArgs;
    }
    process.nextTick(processTasks);
  }

  startParallel();
}

function runParallelEach(batchSize, worker, callerArgs, callerContext) {
  if (!(callerContext instanceof ContextBase)) {
    throw new Error('The context of the parallelEach function is illegal. The function is out of the flow.');
  }
  var values;
  if (callerArgs.length === 1 && Array.isArray(callerArgs[0])) {
    values = callerArgs[0];
  } else {
    values = callerArgs;
  }
  var tasks = values.map(function (value) {
    return function () {
      worker.call(this, value);
    }
  });
  runParallel(batchSize, tasks, [], callerContext);
}

function Queue(batchSize, worker, callerContext) {
  this.batchSize = batchSize;
  this.worker = worker;
  this.callerContext = callerContext;
  this.values = [];
  this.results = [];
  this.isAddingCompleted = false;
  this.isPushed = false;
  this.length = 0;
  this.index = 0;

  if (!(callerContext instanceof ContextBase)) {
    throw new Error('The context of the queue function is illegal. The function is out of the flow.');
  }
}

Queue.prototype.push = function(value) {
  if (this.isAddingCompleted) {
    throw new Error('This queue has already been frozen.');
  }

  var queue = this;
  queue.values.push(value);
  queue.length++;
  if (!queue.isPushed) {
    queue.isPushed = true;
    process.nextTick(processValues);
  }

  function QueueContext(values, index, data) {
    ContextBase.call(this);
    this.values = values;
    this.index = index;
    this.data = data;
    this.isFirst = index === 0;
    this.isLast = index === queue.isAddingCompleted && index === queue.length - 1;
    this.next = this.next.bind(this);
    this.end = this.end.bind(this);
    this.callback = this.callback.bind(this);
  }

  util.inherits(QueueContext, ContextBase);

  QueueContext.prototype.next = function (result) {
    queue.results[this.index] = result;
    queue.index++;
    queue.callerContext.data = this.data;
    if (this.values.length) {
      runWorker(this.values.shift(), this.values);
    } else {
      process.nextTick(processValues);
    }
  };
  
  QueueContext.prototype.end = function () {
    queue.callerContext.data = this.data;
    queue.callerContext.end.apply(queue.callerContext, arguments);
  };
  
  QueueContext.prototype.callback = function () {
    if (arguments[0]) {
      this.end.apply(this, arguments);
    } else {
      this.next.apply(this, Array.prototype.slice.call(arguments, 1));
    }
  };
    
  function runWorker(value, values) {
    queue.worker.call(new QueueContext(values, queue.index, queue.callerContext.data), value);
  }
    
  function processValues() {
    var values = queue.batchSize > 0 ? queue.values.splice(0, queue.batchSize) : queue.values;
    if (values.length === 0) {
      if (queue.isAddingCompleted) {
        queue.callerContext.data = queue.data;
        queue.callerContext.next.call(queue.callerContext, queue.results);
      } else {
        process.nextTick(processValues);
      }
    } else {
      runWorker(values.shift(), values)
    }
  }  
};

Queue.prototype.complete = function() {
  this.isAddingCompleted = true;
};

function ParallelQueue(batchSize, worker, callerContext) {
  this.batchSize = batchSize;
  this.worker = worker;
  this.callerContext = callerContext;
  this.values = [];
  this.isAddingCompleted = false;
  this.isCanceled = false;
  this.isPushed = false;
  this.length = 0;
  this.backlog = 0;
  this.results = [];

  if (!(callerContext instanceof ContextBase)) {
    throw new Error('The context of the parallelQueue function is illegal. The function is out of the flow.');
  }
}

ParallelQueue.prototype.push = function (value) {
  if (this.isAddingCompleted) {
    throw new Error('This parallel queue has been already frozen.');
  }
  if (this.isCanceled) {
    return;
  }

  var queue = this;
  queue.values.push({index : this.length, value: value});
  queue.length++;
  queue.backlog++;
  if (!queue.isPushed) {
    queue.isPushed = true;
  }
  process.nextTick(processValues);

  function ParallelQueueContext(batchSize, data, index) {
    ContextBase.call(this);
    this.batchSize = batchSize;
    this.data = data;
    this.index = index;
    this.next = this.next.bind(this);
    this.end = this.end.bind(this);
    this.callback = this.callback.bind(this);
  }

  util.inherits(ParallelQueueContext, ContextBase);

  ParallelQueueContext.prototype.next = function (result) {
    queue.callerContext.data = this.data;
    queue.results[this.index] = result;
    queue.backlog--;
  };

  ParallelQueueContext.prototype.end = function () {
    queue.isCanceled = true;
    queue.callerContext.data = this.data;
    queue.callerContext.end.apply(queue.callerContext, arguments);
  };

  ParallelQueueContext.prototype.callback = function () {
    if (arguments[0]) {
      this.end.apply(this, arguments);
    } else {
      this.next.apply(this, Array.prototype.slice.call(arguments, 1));
    }
  };

  function endParallelQueue() {
    if (queue.backlog === 1) {
      queue.callerContext.next.call(queue.callerContext, queue.results);
    } else {
      process.nextTick(endParallelQueue);
    }
  }

  function runWorker(value) {
    var context = new ParallelQueueContext(queue.batchSize, queue.callerContext.data, value.index);
    queue.worker.call(context, value.value);
  }

  function processValues() {
    var value;
    var i;
    for (i = 0;  queue.values.length && (queue.batchSize > 0 && i < queue.batchSize || queue.batchSize < 0); i++) {
      if (queue.isCanceled) {
        break;
      }
      value = queue.values.shift();
      if (value.value === sentinel) {
        process.nextTick(endParallelQueue);
      } else {
        runWorker(value);
      }
    }
  }
};

ParallelQueue.prototype.complete = function() {
  this.push(sentinel);
  this.isAddingCompleted = true;
};
