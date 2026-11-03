import type {PropertySchema,ToolParameterSchema} from './types.js';

/** Resolve plain local $ref + annotations for argument coercion/validation.
 * Keep the original provider schema untouched. Complex sibling constraints,
 * external references and cycles stay with the remote schema validator.
 */
export function localValidationSchema(schema: PropertySchema, root: ToolParameterSchema): PropertySchema {
  let current=schema;const seen=new Set<string>();
  for(let depth=0;depth<32;depth++) {
    const record=current as unknown as Record<string,unknown>;
    const ref=record.$ref;
    if(typeof ref!=='string'||!ref.startsWith('#/')||seen.has(ref))return current;
    if(Object.keys(record).some(key=>!['$ref','description','title','default','deprecated','examples'].includes(key)))return current;
    seen.add(ref);let value:unknown=root;
    for(const encoded of ref.slice(2).split('/')){
      if(/~(?![01])/u.test(encoded))return current;
      const key=encoded.replace(/~1/g,'/').replace(/~0/g,'~');
      if(!value||typeof value!=='object'||!Object.hasOwn(value,key))return current;
      value=(value as Record<string,unknown>)[key];
    }
    if(!value||typeof value!=='object'||Array.isArray(value))return current;
    current={...(value as PropertySchema)};
  }
  return current;
}
