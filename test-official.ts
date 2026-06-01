import { fetchOfficialServers } from './src/lib/ingest/official';
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

async function run() {
    console.log('Fetching official servers...');
    try {
        const servers = await fetchOfficialServers();
        console.log('Total returned:', servers.length);
    } catch (err) {
        console.error(err);
    }
}
run();
