// snarkjs ships no type declarations; we only use groth16.fullProve.
declare module 'snarkjs' {
  export const groth16: {
    fullProve(
      input: Record<string, string | number | bigint>,
      wasmPath: string,
      zkeyPath: string,
    ): Promise<{
      proof: {
        pi_a: string[]
        pi_b: string[][]
        pi_c: string[]
      }
      publicSignals: string[]
    }>
  }
}
