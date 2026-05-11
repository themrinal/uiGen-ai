const chunks = [];
process.stdin.on('data', d => chunks.push(d));
process.stdin.on('end', () => {
    const input = JSON.parse(Buffer.concat(chunks).toString());
    const fs = require('fs');
    fs.appendFileSync(
        'E:/Practice/Anthropic/uiGen/.claude/hooks/hook-log.txt',
        JSON.stringify(input, null, 2) + '\n---\n'
    );
    process.exit(0);
});