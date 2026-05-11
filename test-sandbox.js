const url = process.env.SANDBOX_URL;
const token = process.env.SANDBOX_AUTH_TOKEN;
async function test() {
  const req = await fetch(`${url}/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] })
  });
  console.log('Status:', req.status);
  const text = await req.text();
  console.log('Response:', text);
}
test();
