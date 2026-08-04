const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const schemaPath = path.join(rootDir, 'shared', 'protocol.schema.json');
const jsOutputPath = path.join(rootDir, 'shared', 'yodamanProtocol.js');
const tsOutputPath = path.join(rootDir, 'shared', 'yodamanProtocol.d.ts');

// Emitted into both generated files. tests/infrastructure/Protocol.test.js
// regenerates and compares byte-for-byte, so this header must come from the
// generator — editing the output files by hand will fail that test.
const GENERATED_HEADER = `/**
 * LOAD-BEARING — GENERATED FILE. DO NOT EDIT, AND DO NOT DELETE.
 *
 * Produced by scripts/generate-protocol.js from shared/protocol.schema.json
 * (npm run generate:protocol). Hand edits are silently overwritten on the next
 * run, and tests/infrastructure/Protocol.test.js fails if this file drifts from
 * what the generator produces.
 *
 * It is also part of the published package (package.json "files") and is
 * required by shared/yodamanClient.js, so exports that look unused in-repo are
 */
`;

function generate() {
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

    // 1. Generate JS file content
    let jsContent = GENERATED_HEADER;
    const enumNames = Object.keys(schema.enums);

    enumNames.forEach((enumName) => {
        const enumData = schema.enums[enumName];
        jsContent += `const ${enumName} = Object.freeze({\n`;
        const keys = Object.keys(enumData.values);
        keys.forEach((key, index) => {
            const comma = index === keys.length - 1 ? '' : ',';
            jsContent += `    ${key}: '${enumData.values[key]}'${comma}\n`;
        });
        jsContent += `});\n\n`;
    });

    jsContent += `function isTaskEvent(event) {
    return Boolean(
        event &&
        typeof event === 'object' &&
        typeof event.type === 'string' &&
        Object.values(TASK_EVENT_TYPES).includes(event.type)
    );
}

function assertTaskEvent(event) {
    if (!isTaskEvent(event)) {
        throw new Error(\`Unsupported YodaMan task event: \${JSON.stringify(event)}\`);
    }
    return event;
}

module.exports = {
`;
    enumNames.forEach((enumName) => {
        jsContent += `    ${enumName},\n`;
    });
    jsContent += `    assertTaskEvent,\n    isTaskEvent\n};\n`;

    // 2. Generate TS declarations (.d.ts)
    let tsContent = GENERATED_HEADER;

    // Map Enum Name to TS Singular Type Name
    const tsEnumTypeNameMap = {
        'TASK_EVENT_TYPES': 'TaskEventType',
        'TASK_STATUSES': 'TaskStatus',
        'PLUGIN_PERMISSIONS': 'PluginPermission'
    };

    enumNames.forEach((enumName) => {
        const enumData = schema.enums[enumName];
        const tsTypeName = tsEnumTypeNameMap[enumName] || enumName;
        tsContent += `export type ${tsTypeName} =\n`;
        const values = Object.values(enumData.values);
        values.forEach((value, index) => {
            const semicolon = index === values.length - 1 ? ';' : '';
            tsContent += `  | '${value}'${semicolon}\n`;
        });
        tsContent += `\n`;
    });

    const interfaceNames = Object.keys(schema.interfaces);
    interfaceNames.forEach((interfaceName) => {
        const interfaceData = schema.interfaces[interfaceName];
        tsContent += `export interface ${interfaceName} {\n`;
        const propNames = Object.keys(interfaceData.properties);
        propNames.forEach((propName) => {
            const prop = interfaceData.properties[propName];
            const isOptional = prop.optional ? '?' : '';
            let propType = prop.type;
            if (propType === 'enum') {
                propType = tsEnumTypeNameMap[prop.enumName] || prop.enumName;
            }
            tsContent += `  ${propName}${isOptional}: ${propType};\n`;
        });
        tsContent += `}\n\n`;
    });

    enumNames.forEach((enumName) => {
        const tsTypeName = tsEnumTypeNameMap[enumName] || enumName;
        tsContent += `export const ${enumName}: Record<string, ${tsTypeName}>;\n`;
    });
    tsContent += `export function isTaskEvent(event: unknown): event is YodaManTaskEvent;\n`;
    tsContent += `export function assertTaskEvent(event: unknown): YodaManTaskEvent;\n`;

    // Write files
    fs.writeFileSync(jsOutputPath, jsContent, 'utf8');
    fs.writeFileSync(tsOutputPath, tsContent, 'utf8');
    console.log('Successfully generated protocol JS and TS declarations.');
}

if (require.main === module) {
    generate();
}

module.exports = { generate };
