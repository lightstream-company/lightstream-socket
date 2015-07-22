/* jslint node: true */
"use strict";

var util = require('util');
require('mock-socket');
window.WebSocket = MockSocket;

//TODO: delete this method once hack used for mock-server is not needed anymore
function buildTestableSocket(Socket) {
  var TestableSocket = function (url, max_retries, retry_interval) {
    Socket.call(this, url, max_retries, retry_interval);
  };

  util.inherits(TestableSocket, Socket);

  TestableSocket.prototype._close = function _close() {
    // hack to avoid calls to previous onclose handler, because of the implementation in mock-socket,
    // which does not replace handler, but add it as a new observer.
    this.socket.service.list['clientOnclose'] = [];
    Socket.prototype._close.call(this);
  };
  return TestableSocket;
}

function setMockServer(url, items) {
  var mock_server = new MockServer(url);
  mock_server.on('connection', function (server) {
    server.on('message', function (data) {
      var points = items;
      data = JSON.parse(data);
      if (data[0] == 'bounding_box_changed') {
        points = items.slice(0, -1);
      }
      console.log('sending ' + points.length + ' points for : ' + data[0]);
      server.send(JSON.stringify(points));
    });
  });

  new MockServer(MockServer.unresolvableURL);

  return mock_server;
}

module.exports = {
  buildTestableSocket: buildTestableSocket,
  setMockServer: setMockServer
};