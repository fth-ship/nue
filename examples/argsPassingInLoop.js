var flow = require('../index').flow;
var fs = require('fs');

var myFlow = flow(
  function (files) {
    process.nextTick(this.async(files));
    files.forEach(function (file) {
      fs.readFile(file, 'utf8', this.async());
    }.bind(this));
  },
  function (files) {
    var data = Array.prototype.slice.call(arguments, 1).join('');
    console.log(files.join(' and ') + ' have been read.');
    this.next(data);
  },
  function (data) {
    if (this.err) throw this.err;
    console.log(data);
    console.log('done');
    this.next();
  }
);

myFlow(['file1', 'file2']);