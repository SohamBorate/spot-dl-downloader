"use strict";

class PromiseEvent extends Promise {
    _events = {};
    on = (eventName, callback) => {
        let event = this._events[eventName];
        if (!event) {
            event = [];
        }
        event.push(callback)
        this._events[eventName] = event;
    }
    emit = (eventName, data) => {
        let event = this._events[eventName];
        if (!event) { return; }
        event.forEach((callback) => {
            callback(data);
        });
    }
}

module.exports = PromiseEvent;