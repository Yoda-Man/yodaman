const fs = require('fs');
const path = require('path');

describe('FileUploader frontend contract', () => {
    const uploaderPath = path.resolve(__dirname, '../../frontend/FileUploader.jsx');
    const chatPath = path.resolve(__dirname, '../../src/components/AgentChatTab.jsx');
    const apiPath = path.resolve(__dirname, '../../src/api/api.js');

    function read(filePath) {
        return fs.readFileSync(filePath, 'utf8');
    }

    test('renders upload controls and calls temp upload/delete APIs', () => {
        const text = read(uploaderPath);

        expect(text).toContain('export default function FileUploader');
        expect(text).toContain('accept=".dart,.js,.ts,.json,.yaml,.md,.log,.txt"');
        expect(text).toContain('api.uploadTempFile');
        expect(text).toContain('api.deleteTempUploadFile');
        expect(text).toContain('onFilesChange');
        expect(text).toContain('Files are stored locally only');
    });

    test('api exposes upload helpers and agent tasks include fileIds', () => {
        const text = read(apiPath);

        expect(text).toContain('async uploadTempFile(file)');
        expect(text).toContain('async attachUploadFile(taskId, fileId)');
        expect(text).toContain('async deleteTempUploadFile(fileId)');
        expect(text).toContain('async listTaskUploadFiles(taskId)');
        expect(text).toContain('fileIds: context.fileIds || []');
    });

    test('agent chat uses FileUploader and includes uploaded file ids in context', () => {
        const text = read(chatPath);

        expect(text).toContain("import FileUploader from '../../frontend/FileUploader.jsx'");
        expect(text).toContain('<FileUploader');
        expect(text).toContain('setAttachedFiles');
        expect(text).toContain('fileIds: attachedFiles.map(file => file.fileId)');
    });
});
