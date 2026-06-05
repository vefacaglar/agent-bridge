import { EventEmitter } from "events";

export const eventBus = new EventEmitter();

// Set high limits to support multiple parallel browser connections
eventBus.setMaxListeners(100);
