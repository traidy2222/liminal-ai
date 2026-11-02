/** Desktop output consumers disappear when their owning window/process exits. */
export function ignoreBrokenParentPipe(output: NodeJS.WritableStream): void {
  output.on('error', (error: NodeJS.ErrnoException) => {
    // Do not turn a normal desktop disconnect into recursive uncaught-error logs.
    if (error.code !== 'EPIPE') throw error;
  });
}
