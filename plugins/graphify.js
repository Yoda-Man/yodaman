const graphifyService = require('../backend/infrastructure/GraphifyService');

module.exports = {
    name: 'graphify',
    description: 'Queries, explains, and traverses the mandatory Graphify workspace knowledge graph.',
    permissions: ['read', 'search'],
    parameters: {
        action: 'query | explain | path | affected | status | build',
        path: 'Absolute workspace path',
        query: 'Natural language graph query for action=query',
        node: 'Graph node name for action=explain',
        source: 'Source node for action=path',
        target: 'Target node for action=path'
    },
    async execute(parameters = {}) {
        const action = parameters.action || 'query';
        const projectPath = parameters.path || process.cwd();

        if (action === 'status') {
            return graphifyService.status(projectPath);
        }

        if (action === 'build') {
            return graphifyService.build(projectPath, { update: true });
        }

        if (action === 'explain') {
            if (!parameters.node) throw new Error('node is required for graphify explain');
            return {
                explanation: await graphifyService.explain(parameters.node, projectPath),
                graphPath: graphifyService.graphPath(projectPath)
            };
        }

        if (action === 'path') {
            if (!parameters.source || !parameters.target) {
                throw new Error('source and target are required for graphify path');
            }
            return {
                result: await graphifyService.pathBetween(parameters.source, parameters.target, projectPath),
                graphPath: graphifyService.graphPath(projectPath)
            };
        }

        if (action === 'affected') {
            if (!parameters.node) throw new Error('node is required for graphify affected');
            return {
                impact: await graphifyService.affected(parameters.node, projectPath, {
                    depth: parameters.depth || 2,
                    relations: parameters.relations || []
                }),
                graphPath: graphifyService.graphPath(projectPath)
            };
        }

        if (!parameters.query) throw new Error('query is required for graphify query');
        return {
            insights: await graphifyService.query(parameters.query, projectPath),
            graphPath: graphifyService.graphPath(projectPath)
        };
    }
};
