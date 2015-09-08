/* jslint node: true */
/* jslint expr: true */
/*global describe, it, before, beforeEach, after, afterEach */
"use strict";

var chai = require('chai');
var should = chai.should();
var sinon = require('sinon');
var sinon_chai = require('sinon-chai');
chai.use(sinon_chai);
chai.use(require('chai-things'));
var _ = require('lodash');

var assertAsync = require('./test_helper').assertAsync;
var buildTestableSocket = require('./socket_helper').buildTestableSocket;
var setMockServer = require('./socket_helper').setMockServer;
var closeSocket = require('./socket_helper').closeSocket;
var assertHistoryItems = require('./socket_helper').assertHistoryItems;

var ConnectionError = require('../lib/ConnectionError');
var Socket = buildTestableSocket(require('../lib/Socket'));

describe('Socket behavior', function () {
  var url = 'ws://localhost/socket';
  var mock_server, spy, type, options;
  var bounding_box, filter;
  var items = [{
    geojson: {coordinates: [3.97, 43.58]},
    data: { linked_item: 34 }
  }, {
    geojson: {coordinates: [4.02, 43.63]},
    data: { linked_item: 48 }
  }, {
    geojson: {coordinates: [3.88, 43.55]},
    data: { linked_item: 34 }
  }];

  beforeEach(function () {
    type = 'station';
    options = {};
    filter = undefined; // used in spies, where null differs from undefined
    bounding_box = undefined; // used in spies, where null differs from undefined
    spy = sinon.spy();

    mock_server = setMockServer(url, items, spy);
    new MockServer(MockServer.unresolvableURL);
  });

  describe('Socket connect and reconnect', function () {

    it('should connect to websocket server', function (done) {
      var socket = new Socket(url, type);

      var timeout;
      socket.on('opened', function () {
        clearTimeout(timeout);
        function assert() {
          socket.isOpened().should.be.true;
        }

        assertAsync(assert, done);
        socket.close();
      });

      socket.connect();
      timeout = setTimeout(function () {
        socket.close();
        done(new Error('open event should have been called'));
      }, 10);
    });

    it('should try to reconnect when first attempt fails', function (done) {
      var options = {
        max_retries: 2,
        retry_interval: 200
      };
      var socket = new Socket(MockServer.unresolvableURL, type, options);

      var timeout;
      socket.on('error', function () {
        clearTimeout(timeout);
        function assert() {
          socket.isOpened().should.be.false;
        }

        assertAsync(assert, done);
      });

      socket.connect();
      timeout = setTimeout(function () {
        done(new Error('error event should have been called'));
      }, 500);
    });

    it('should try to reconnect infinitely when socket is closed by the server, unless abort has been called', function (done) {
      mock_server.on('connection', function () {
        setTimeout(function () {
          mock_server.close();
        }, 20);
      });

      var options = {
        max_retries: Socket.INFINITE_RETRIES,
        retry_interval: 80
      };
      var socket = new Socket(url, type, options);

      var timeout;
      socket.on('error', function (error) {
        clearTimeout(timeout);
        function assert() {
          socket.isOpened().should.be.false;
          error.should.be.an.instanceof(ConnectionError);
        }

        assertAsync(assert, done);
      });

      socket.connect();
      setTimeout(function () {
        socket.abort();
      }, 350);

      timeout = setTimeout(function () {
        done(new Error('error event should have been called, after aborting'));
      }, 500);
    });

    it('should not try to reconnect if socket is closed by the client', function (done) {
      var socket = new Socket(url, type);

      var timeout;
      socket.on('closed', function () {
        clearTimeout(timeout);
        function assert() {
          socket.isOpened().should.be.false;
        }

        assertAsync(assert, done);
      });
      socket.on('opened', function () {
        socket.close();
      });

      socket.connect();
      timeout = setTimeout(function () {
        done(new Error('closed event should have been called'));
      }, 50);
    });
  });

  function test_socket_initialization(initialize_socket, event, items_count, done) {
    var socket = new Socket(url, type, options);
    socket.on('opened', function () {
      initialize_socket(socket);
    });

    var timeout;
    function clear() { clearTimeout(timeout); }

    function assert(items) {
      return function () {
        spy.should.have.been.calledWithMatch({
          event: event,
          bounding_box: bounding_box,
          filter: filter,
          type: 'station'
        });
        items.should.have.length(items_count);
      }
    }

    socket.on('new_items', assertHistoryItems(socket, assert, done, clear));

    socket.connect();
    timeout = setTimeout(function () {
      closeSocket(socket);
      done(new Error('new_items event should have been called for ' + event + ' event'));
    }, 100);
  }

  function test_socket_reconnection(initialize_socket, items_count, done) {
    options = _.assign({
      max_retries: 2,
      retry_interval: 200
    }, options);
    var socket = new Socket(url, type, options);

    var timeout;
    function clear() { clearTimeout(timeout); }

    socket.on('opened', function () {
      socket.removeAllListeners('opened');
      initialize_socket(socket);

      socket.on('opened', function () {
        socket.retries_done.should.equal(0);
        function assert(items) {
          return function () {
            items.should.have.length(items_count);
          }
        }

        socket.on('new_items', assertHistoryItems(socket, assert, done, clear));
      });

      mock_server.close();
    });

    socket.connect();
    timeout = setTimeout(function () {
      closeSocket(socket);
      done(new Error('new_items event should have been called after reconnect'));
    }, 500);
  }

  describe('Listen socket', function () {
    var initialize_socket = function (socket) {
      socket.listen();
    };

    it('should listen to new items', function (done) {
      test_socket_initialization(initialize_socket, "ready", 3, done);
    });

    it('should listen again if socket is closed by the server', function (done) {
      test_socket_reconnection(initialize_socket, 3, done);
    });
  });

  describe('Set Bounding Box', function () {
    var initialize_socket = function (socket) {
      socket.initializeBoundingBox(bounding_box);
    };

    beforeEach(function () {
      bounding_box = [3.78, 43.55, 4.04, 43.65];
    });

    it('should set a bounding box, then load history items and subscribe to new items', function (done) {
      test_socket_initialization(initialize_socket, "bounding_box_initialized", 3, done);
    });

    it('should re set the bounding box if socket is closed by the server', function (done) {
      test_socket_reconnection(initialize_socket, 3, done);
    });
  });

  describe('Set filter', function () {
    var initialize_socket = function (socket) {
      socket.listen();
    };

    beforeEach(function () {
      filter = { linked_item: 48 };
      options = { filter: filter };
    });

    it('should apply a filter', function (done) {
      test_socket_initialization(initialize_socket, 'ready', 1, done);
    });

    it('should change the applied filter', function (done) {
      var socket = new Socket(url, type, options);
      socket.on('opened', function () {
        initialize_socket(socket);
      });

      function assert(items) {
        return function () {
          spy.should.have.been.calledWithMatch({
            event: 'filter_changed',
            filter: filter,
            type: 'station'
          });
          items.should.have.length(2);
        }
      }

      var timeout;
      function clear() { clearTimeout(timeout); }

      socket.on('new_items', function () {
        filter = { linked_item: 34 };

        socket.removeAllListeners('new_items');
        socket.on('new_items', assertHistoryItems(socket, assert, done, clear));
        socket.changeFilter(filter);
      });

      socket.connect();
      timeout = setTimeout(function () {
        closeSocket(socket);
        done(new Error('new_items event should have been called for filter changed event'));
      }, 100);
    });
  });
});
