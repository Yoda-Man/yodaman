const { classifyQuery } = require('../../backend/utils/queryClassifier');

describe('queryClassifier', () => {
    test('classifies code-shaped queries as code', () => {
        expect(classifyQuery('function handleSubmit')).toBe('code');
        expect(classifyQuery('where is module.exports defined')).toBe('code');
    });

    test('classifies documentation-shaped queries as doc', () => {
        expect(classifyQuery('how to configure the api')).toBe('doc');
        expect(classifyQuery('explain README setup steps')).toBe('doc');
    });

    test('uses safe defaults for empty or non-string input', () => {
        expect(classifyQuery('')).toBe('code');
        expect(classifyQuery(null)).toBe('code');
    });
});
