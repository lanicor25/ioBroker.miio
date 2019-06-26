"use strict";
/*
 * Created with @iobroker/create-adapter v1.14.0
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const miio = require("./lib/miio");
class Miio extends utils.Adapter {
    constructor(options = {}) {
        super(Object.assign({}, options, { name: "miio" }));
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        // this.on("message", this.onMessage.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.miioObjects = {};
        this.delayed = {};
        this.tasks = [];
        this.miioController = null;
    }
    /**
     * Is called when databases are connected and adapter received configuration.
     */
    onReady() {
        return __awaiter(this, void 0, void 0, function* () {
            // Initialize your adapter here
            // Reset the connection indicator during startup
            this.setConnected(false);
            // in this template all states changes inside the adapters namespace are subscribed
            this.subscribeStates("*");
            this.miioAdapterInit();
        });
    }
    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     */
    onUnload(callback) {
        try {
            this.log.info("cleaned everything up...");
            this.miioAdapterStop();
            callback();
        }
        catch (e) {
            callback();
        }
    }
    /**
     * Is called if a subscribed state changes
     */
    onStateChange(id, state) {
        if (!id || !state || state.ack) {
            return;
        }
        if (!this.miioObjects[id]) {
            this.log.warn(`Unknown ID: ${id}`);
            return;
        }
        if (this.miioController) {
            const channelEnd = id.lastIndexOf(".");
            const channelId = id.substring(0, channelEnd);
            const stateName = id.substring(channelEnd + 1);
            if (this.miioObjects[channelId] && this.miioObjects[channelId].native) {
                state = state.val;
                this.log.debug(`onStateChange. state=${stateName} val=${JSON.stringify(state)}`);
                this.miioController.setState(this.miioObjects[channelId].native.id, stateName, state);
            }
        }
        else {
            this.log.warn(`no miio controller`);
        }
    }
    // /**
    //  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
    //  * Using this method requires "common.message" property to be set to true in io-package.json
    //  */
    // private onMessage(obj: ioBroker.Message): void {
    // 	if (typeof obj === "object" && obj.message) {
    // 		if (obj.command === "send") {
    // 			// e.g. send email or pushover or whatever
    // 			this.log.info("send command");
    // 			// Send response in callback if required
    // 			if (obj.callback) this.sendTo(obj.from, obj.command, "Message received", obj.callback);
    // 		}
    // 	}
    // }
    /**
     * Is called to set adapter connection status
     */
    setConnected(conn) {
        this.setState("info.connection", conn, true);
    }
    getObjectIDPrefix() {
        return this.namespace + ".devices";
    }
    getSelfObjectIDPrefix() {
        return "devices";
    }
    generateChannelID(id) {
        return this.getObjectIDPrefix() + "." + id;
    }
    generateSelfChannelID(id) {
        return this.getSelfObjectIDPrefix() + "." + id;
    }
    /**
     * Is called to find exist miio objects
     */
    readObjects(callback) {
        this.getForeignObjects(this.getObjectIDPrefix() + ".*", (err, list) => {
            // Read miio objects in database. This maybe set in prevrous running status.
            // No need set namespace
            this.subscribeStates("devices.*");
            this.miioObjects = list;
            callback && callback();
        });
    }
    miioAdapterUpdateState(id, state, val) {
        if (this.miioObjects[this.namespace + "." + id] ||
            this.miioObjects[this.namespace + "." + id + "." + state]) {
            //TODO: what if only id exist?
            this.setState(id + "." + state, val, true);
        }
        else {
            this.delayed[id + "." + state] = val;
        }
    }
    miioAdapterSyncObjects(instant) {
        function isStateObject(obj) {
            return obj.type === "state";
        }
        // This obj is obj with new value
        const obj = instant.tasks.shift();
        if (obj === undefined) {
            return;
        }
        instant.getObject(obj._id, (err, oObj) => {
            if (!oObj) {
                //No obj._id data stored in database. Just set this obj
                instant.miioObjects[instant.namespace + "." + obj._id] = obj;
                instant.setObject(obj._id, obj, () => {
                    if (instant.delayed[obj._id] !== undefined) {
                        instant.setState(obj._id, instant.delayed[obj._id], true, () => {
                            delete instant.delayed[obj._id];
                            setImmediate(instant.miioAdapterSyncObjects, instant);
                        });
                    }
                    else {
                        setImmediate(instant.miioAdapterSyncObjects, instant);
                    }
                });
            }
            else if (isStateObject(oObj) && isStateObject(obj)) {
                //Database contains obj._id object. Check whether update is needed.
                let changed = false;
                for (const a in obj.common) {
                    if (obj.common.hasOwnProperty(a)) {
                        if (!oObj.common[a] ||
                            ((a != "name") && (a !== "icon") && (a !== "role") && oObj.common[a] !== obj.common[a])) {
                            // object value need update.
                            changed = true;
                            oObj.common[a] = obj.common[a];
                        }
                    }
                }
                if (JSON.stringify(obj.native) !== JSON.stringify(oObj.native)) {
                    changed = true;
                    oObj.native = obj.native;
                }
                // The newest data is saved in oObj.
                instant.miioObjects[instant.namespace + "." + obj._id] = oObj;
                if (changed) {
                    instant.extendObject(oObj._id, oObj, () => {
                        if (instant.delayed[oObj._id] !== undefined) {
                            instant.setState(oObj._id, instant.delayed[oObj._id], true, () => {
                                delete instant.delayed[oObj._id];
                                setImmediate(instant.miioAdapterSyncObjects, instant);
                            });
                        }
                        else {
                            setImmediate(instant.miioAdapterSyncObjects, instant);
                        }
                    });
                }
                else {
                    if (instant.delayed[oObj._id] !== undefined) {
                        instant.setState(oObj._id, instant.delayed[oObj._id], true, () => {
                            delete instant.delayed[oObj._id];
                            setImmediate(instant.miioAdapterSyncObjects, instant);
                        });
                    }
                    else {
                        setImmediate(instant.miioAdapterSyncObjects, instant);
                    }
                }
            }
            else {
                if (instant.delayed[oObj._id] !== undefined) {
                    instant.setState(oObj._id, instant.delayed[oObj._id], true, () => {
                        delete instant.delayed[oObj._id];
                        setImmediate(instant.miioAdapterSyncObjects, instant);
                    });
                }
                else {
                    setImmediate(instant.miioAdapterSyncObjects, instant);
                }
            }
        });
    }
    miioAdapterCreateDevice(dev) {
        const id = this.generateSelfChannelID(dev.miioInfo.id);
        const isInitTasks = !this.tasks.length;
        const states = dev.device.states;
        for (const state in states) {
            if (!states.hasOwnProperty(state))
                continue;
            this.log.info(`Create state object ${id}.${state}`);
            this.tasks.push({
                _id: `${id}.${state}`,
                common: states[state],
                type: "state",
                native: {}
            });
        }
        this.tasks.push({
            _id: id,
            common: {
                name: dev.configData.name || dev.miioInfo.model,
                icon: `/icons/${dev.miioInfo.model}.png`
            },
            type: "channel",
            native: {
                id: dev.miioInfo.id,
                model: dev.miioInfo.model
            }
        });
        isInitTasks && this.miioAdapterSyncObjects(this);
    }
    miioAdapterDeleteDevice(dev) {
        const id = this.generateSelfChannelID(dev.miioInfo.id);
        const states = dev.device.states;
        for (const state in states) {
            if (!states.hasOwnProperty(state))
                continue;
            this.log.info(`Delete state object ${id}.${state}`);
            this.delObject(`${id}.${state}`);
        }
        this.delObject(`${id}`);
    }
    miioAdapterStop() {
        if (this.miioController) {
            try {
                this.miioController.stop();
                this.miioController = null;
            }
            catch (e) {
                this.log.error(`adapter stop failed.` + e);
            }
        }
    }
    miioAdapterUpdateConfig(configData) {
        for (let i = 0; i < this.config.devices.length; i++) {
            if (configData.token === this.config.devices[i].token) {
                if ((configData.ip === this.config.devices[i].ip) && (configData.polling === this.config.devices[i].polling)) {
                    return;
                }
                this.config.devices[i].ip = configData.ip;
                this.config.devices[i].polling = configData.polling;
                this.log.info(`Update Device ${configData.name}'s config: ip = ${configData.ip}, polling = ${configData.polling}`);
                this.updateConfig(this.config);
                return;
            }
        }
        // New discovered device
        this.config.devices.push(configData);
        this.log.info(`Update Device ${configData.name}'s config: ip = ${configData.ip}, polling = ${configData.polling}`);
        this.updateConfig(this.config);
    }
    miioAdapterInit() {
        this.readObjects(() => {
            this.setConnected(false);
            if (!this.config ||
                !this.config.devices ||
                ("[]" === JSON.stringify(this.config.devices))) {
                if (!this.config.autoDiscover) {
                    this.log.error("No device defined and discover is also disabled.");
                }
            }
            this.miioController = new miio.Controller({
                devicesDefined: this.config.devices,
                autoDiscover: this.config.autoDiscover,
                autoDiscoverTimeout: parseInt(this.config.autoDiscoverTimeout || "30") //
            });
            this.miioController.on("debug", /** @param {string} msg */ /** @param {string} msg */ msg => this.log.debug(msg));
            this.miioController.on("info", /** @param {string} msg */ /** @param {string} msg */ msg => this.log.info(msg));
            this.miioController.on("warning", /** @param {string} msg */ /** @param {string} msg */ msg => this.log.warn(msg));
            this.miioController.on("error", /** @param {string} msg */ /** @param {string} msg */ msg => {
                this.log.error(msg);
                this.miioAdapterStop();
            });
            // New device need add to adapter.
            this.miioController.on("device", (/** @param {AdapterMiio.ControllerDevice} dev */ dev, /** @param {string} opt */ opt) => {
                if (opt === "add") {
                    if (!this.miioObjects[this.generateChannelID(dev.miioInfo.id)]) {
                        this.log.info(`New device: ${dev.miioInfo.model}. ID ${dev.miioInfo.id}`);
                        this.miioAdapterUpdateConfig(dev.configData);
                        this.miioAdapterCreateDevice(dev);
                    }
                    else {
                        this.log.info(`Known device: ${dev.miioInfo.model} ${dev.miioInfo.id}`);
                    }
                }
                else if (opt === "delete") {
                    if (this.miioObjects[this.generateChannelID(dev.miioInfo.id)]) {
                        this.miioAdapterDeleteDevice(dev);
                        this.log.info(`Delete device: ${dev.miioInfo.model}. ID ${dev.miioInfo.id}`);
                    }
                    else {
                        this.log.info(`Want to delete a non-registered device: ${dev.miioInfo.model}. ID ${dev.miioInfo.id}`);
                    }
                }
                else {
                    this.log.warn(`Unsupported device event operation "${opt}".`);
                }
            });
            this.miioController.on("data", 
            /**
             * @param {string} id
             * @param {string} state
             * @param {any} val
             */
            (id, state, val) => {
                this.miioAdapterUpdateState(this.generateSelfChannelID(id), state, val);
            });
            this.miioController.listen();
            this.setConnected(true);
        });
    }
}
if (module.parent) {
    // Export the constructor in compact mode
    module.exports = (options) => new Miio(options);
}
else {
    // otherwise start the instance directly
    (() => new Miio())();
}