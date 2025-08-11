const fs = require('fs-extra');
const puppeteer = require('puppeteer');

async function debugTest() {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage'
        ]
    });
    
    const page = await browser.newPage();
    
    try {
        console.log('Loading page...');
        await page.goto('https://climate-adapt.eea.europa.eu/', { 
            waitUntil: 'domcontentloaded',
            timeout: 60000 
        });
        
        console.log('Page loaded, waiting for content...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        console.log('Extracting content...');
        const content = await page.evaluate(() => {
            console.log('Document ready state:', document.readyState);
            console.log('Document title:', document.title);
            console.log('Document body length:', document.body ? document.body.innerHTML.length : 'no body');
            
            return document.documentElement.outerHTML;
        });
        
        console.log('Content length:', content.length);
        console.log('First 500 chars:');
        console.log(content.substring(0, 500));
        
        if (content.length > 0) {
            await fs.writeFile('debug_output.html', content, 'utf8');
            console.log('Saved debug_output.html');
        }
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await browser.close();
    }
}

debugTest();
