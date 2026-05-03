import { EventEmitter } from "node:events";
import type { AgentEventMap, AgentEventName } from "./types.js";

export class AgentEmitter {
  private readonly emitter = new EventEmitter({ captureRejections: true });

  on<K extends AgentEventName>(
    event: K,
    listener: (payload: AgentEventMap[K]) => void
  ): this {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
    return this;
  }

  once<K extends AgentEventName>(
    event: K,
    listener: (payload: AgentEventMap[K]) => void
  ): this {
    this.emitter.once(event, listener as (...args: unknown[]) => void);
    return this;
  }

  off<K extends AgentEventName>(
    event: K,
    listener: (payload: AgentEventMap[K]) => void
  ): this {
    this.emitter.off(event, listener as (...args: unknown[]) => void);
    return this;
  }

  emit<K extends AgentEventName>(event: K, payload: AgentEventMap[K]): void {
    this.emitter.emit(event, payload);
  }
}
