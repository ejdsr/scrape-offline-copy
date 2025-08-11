// Simple test to verify the scraper functionality
const WebsiteScraper = require('./index.js');

async function testScraper() {
    console.log('Starting test...');
    
    const scraper = new WebsiteScraper('https://httpbin.org/html', 'test-output');
    await scraper.scrape();
    
    console.log('Test completed!');
}

if (require.main === module) {
    testScraper().catch(console.error);
}
