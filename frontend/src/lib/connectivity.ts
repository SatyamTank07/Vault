import { useSyncExternalStore } from 'react';

/** Whether the Vault server answered the last request. Starts optimistic until a request says otherwise. */
let online = true;
const listeners = new Set<() => void>();

export function reportConnectivity(reachable: boolean) {
  if (reachable === online) return;
  online = reachable;
  listeners.forEach((listener) => listener());
}

export function isOnline(): boolean {
  return online;
}

export function subscribeConnectivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeConnectivity, isOnline);
}

/** Called after the server accepted a change, so the local copy can refresh itself. */
const writeListeners = new Set<() => void>();

export function onServerWrite(listener: () => void): () => void {
  writeListeners.add(listener);
  return () => writeListeners.delete(listener);
}

export function reportServerWrite() {
  writeListeners.forEach((listener) => listener());
}
