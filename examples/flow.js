var nue = require('../lib/nue');
var flow = nue.flow;
var fs = require('fs');

flow(
  function () {
    this.data = [];
    fs.readFile('LICENSE', this.next);
  },
  function (err, data) {
    if (err) this.end(err);
    this.data.push(data.length);
    fs.readFile('README.md', this.next);
  },
  function (err, data) {
    if (err) this.end(err);
    this.data.push(data.length);
    this.next();
  },
  function (err) {
    if (err) throw err;
    console.log(this.data);
  }
)();