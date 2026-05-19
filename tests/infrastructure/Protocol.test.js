const fs = require('fs');
const path = require('path');
const { generate } = require('../../scripts/generate-protocol');

describe('Protocol Generation Consistency', () => {
    it('should have up-to-date generated protocol files matching the schema', () => {
        const rootDir = path.resolve(__dirname, '../..');
        const jsPath = path.join(rootDir, 'shared', 'yodamanProtocol.js');
        const tsPath = path.join(rootDir, 'shared', 'yodamanProtocol.d.ts');

        const originalJs = fs.readFileSync(jsPath, 'utf8');
        const originalTs = fs.readFileSync(tsPath, 'utf8');

        // Run the generator
        generate();

        const newJs = fs.readFileSync(jsPath, 'utf8');
        const newTs = fs.readFileSync(tsPath, 'utf8');

        // Restore if different to avoid dirtying git during test runs if something went wrong
        if (originalJs !== newJs) {
            fs.writeFileSync(jsPath, originalJs, 'utf8');
        }
        if (originalTs !== newTs) {
            fs.writeFileSync(tsPath, originalTs, 'utf8');
        }

        expect(newJs).toBe(originalJs);
        expect(newTs).toBe(originalTs);
    });
});
