/* jslint node: true */
"use strict";

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var ConnectionError = require('./ConnectionError');
var BoundingBox = require('./BoundingBox');


function Socket(url, type, options) {
  EventEmitter.call(this);

  options = options || {};
  this.url = url;
  this.type = type;
  this.stream = options.stream;
  this.filter = options.filter;

  this.max_retries = options.max_retries || Socket.INFINITE_RETRIES;
  this.retries_done = 0;
  this.retry_interval = options.retry_interval || 1000;

  this.is_opened = false;
  this.aborted = false;
}

util.inherits(Socket, EventEmitter);

Socket.INFINITE_RETRIES = 0;

Socket.prototype.connect = function connect() {
  this.aborted = false;
  this._connect();
};

Socket.prototype._connect = function _connect() {
  var self = this;
  this.socket = new WebSocket(this.url);
  this.socket.onopen = function () {
    console.log('socket connected');
    self.is_opened = true;
    self._reset();
    self.emit('opened');
  };
  this.socket.onerror = this._onError();
  this.socket.onclose = this._onClose();
};

Socket.prototype._onError = function _onError() {
  return this._onClose();
};

Socket.prototype._onClose = function _onClose() {
  var self = this;
  return function (event) {
    self._close();
    self._reconnect();
  };
};

Socket.prototype._canRetry = function _canRetry() {
  return !this.aborted && (this.max_retries === Socket.INFINITE_RETRIES || this.retries_done < this.max_retries);
};

Socket.prototype._reconnect = function _reconnect() {
  var self = this;
  if (this._canRetry()) {
    this.retries_done++;
    setTimeout(function () {
      self._connect();
    }, this.retry_interval);
  } else {
    this._emitError(new ConnectionError(this.url, this.retries_done));
    this._close();
  }
};

Socket.prototype._emitError = function _emitError(error) {
  this.emit('error', error);
};

Socket.prototype.isOpened = function isOpened() {
  return this.is_opened;
};

Socket.prototype.listen = function listen() {
  if (!this.listening) {
    this._listen();
  }
};

Socket.prototype._listen = function _listen() {
  this._listenSocket();
  this._sendMessage('ready');
};

Socket.prototype._listenSocket = function _listenSocket() {
  var self = this;
  this.socket.onmessage = function (event) {
    self._emitItem(JSON.parse(event.data));
  };
  this.listening = true;
};

Socket.prototype._emitItem = function _emitItem(item) {
  this.emit('new_items', item);
};

Socket.prototype.initializeBoundingBox = function initializeBoundingBox(bounding_box) {
  if (!this.bounding_box) {
    this._initializeBoundingBox(bounding_box);
  }
};

Socket.prototype._initializeBoundingBox = function _initializeBoundingBox(bounding_box) {
  this._setBoundingBox(bounding_box);
  this._listenSocket();
  this._sendMessage('bounding_box_initialized');
};

Socket.prototype._setBoundingBox = function _setBoundingBox(bounding_box) {
  this.bounding_box = new BoundingBox(bounding_box).check();
};

Socket.prototype.changeFilter = function changeFilter(filter) {
  this.filter = filter;
  this._sendMessage('filter_changed');
};

Socket.prototype._reset = function _reset() {
  this.retries_done = 0;
  if (!this.listening) {
    return;
  }

  if (this.bounding_box) {
    return this._initializeBoundingBox(this.bounding_box);
  }
  this._listen();
};

Socket.prototype._sendMessage = function _sendMessage(event) {
  this.socket.send(JSON.stringify({
    event: event,
    type: this.type,
    stream: this.stream,
    bounding_box: this.bounding_box,
    filter: this.filter
  }));
};

Socket.prototype.close = function close() {
  this._close();
  this.listening = false;
  this._emitClosed();
};

Socket.prototype._emitClosed = function _emitClosed() {
  this.emit('closed');
};

Socket.prototype._close = function _close() {
  this.socket.onclose = function () {};
  this.socket.onerror = function () {};
  this.socket.onmessage = function () {};
  if (this.socket.readyState === WebSocket.OPEN) { this.socket.close(); }
  this.is_opened = false;
};

Socket.prototype.abort = function abort() {
  this.aborted = true;
};

module.exports = Socket;