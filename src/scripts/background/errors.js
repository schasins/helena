'use strict'

function ExecError(m) {
  console.log("Error!  Message:", m); // unfortunately we keep seeing "Error in event handler for (unknown): (cannot get error message)", so we're going to also log
  this.message = m;
  var err = new Error();
  console.log(err.stack);
}
ExecError.prototype = Error;
ExecError.prototype.constructor = ExecError;