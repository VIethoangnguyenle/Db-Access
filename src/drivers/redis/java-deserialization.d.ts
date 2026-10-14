declare module "java-deserialization" {
  export function parse(buf: Buffer): any[];
  const _d: { parse: typeof parse };
  export default _d;
}
