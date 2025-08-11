const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');
const { URL } = require('url');
const https = require('https');
const http = require('http');

class WebsiteScraper {
    constructor(baseUrl, outputDir = 'scraped-site') {
        this.baseUrl = baseUrl;
        this.baseDomain = new URL(baseUrl).hostname;
        this.outputDir = outputDir;
        this.visitedUrls = new Set();
        this.pendingUrls = new Set();
        this.downloadedResources = new Set();
        this.browser = null;
        this.page = null;
    }

    async downloadResource(url, outputPath) {
        if (this.downloadedResources.has(url)) {
            return true; // Already downloaded
        }

        try {
            const urlObj = new URL(url);
            const protocol = urlObj.protocol === 'https:' ? https : http;
            
            await fs.ensureDir(path.dirname(outputPath));
            
            return new Promise((resolve, reject) => {
                const file = fs.createWriteStream(outputPath);
                
                const request = protocol.get(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                }, (response) => {
                    if (response.statusCode === 200) {
                        response.pipe(file);
                        file.on('finish', () => {
                            file.close();
                            this.downloadedResources.add(url);
                            console.log(`Downloaded resource: ${path.basename(outputPath)}`);
                            resolve(true);
                        });
                    } else if (response.statusCode === 301 || response.statusCode === 302) {
                        // Handle redirects
                        const redirectUrl = response.headers.location;
                        if (redirectUrl) {
                            const absoluteRedirectUrl = new URL(redirectUrl, url).href;
                            file.close();
                            fs.unlink(outputPath).catch(() => {}); // Clean up empty file
                            this.downloadResource(absoluteRedirectUrl, outputPath).then(resolve).catch(reject);
                        } else {
                            file.close();
                            reject(new Error(`Redirect without location header: ${response.statusCode}`));
                        }
                    } else {
                        file.close();
                        reject(new Error(`HTTP ${response.statusCode}`));
                    }
                });
                
                file.on('error', (err) => {
                    file.close();
                    fs.unlink(outputPath).catch(() => {}); // Clean up on error
                    reject(err);
                });
                
                request.on('error', (err) => {
                    file.close();
                    fs.unlink(outputPath).catch(() => {}); // Clean up on error
                    reject(err);
                });
                
                request.setTimeout(30000, () => {
                    request.destroy();
                    file.close();
                    fs.unlink(outputPath).catch(() => {}); // Clean up on timeout
                    reject(new Error('Download timeout'));
                });
            });
        } catch (error) {
            console.error(`Error downloading ${url}:`, error.message);
            return false;
        }
    }

    getResourcePath(url) {
        try {
            const urlObj = new URL(url);
            let pathname = urlObj.pathname;
            
            // Remove leading slash
            if (pathname.startsWith('/')) {
                pathname = pathname.substring(1);
            }
            
            // If no pathname, use a default name based on the URL
            if (!pathname) {
                pathname = 'resource_' + Date.now();
            }
            
            // Replace invalid filename characters
            pathname = pathname.replace(/[<>:"|?*]/g, '_');
            
            // Ensure we have a file extension
            if (!path.extname(pathname)) {
                // Try to guess extension from URL or content type
                const segments = pathname.split('/');
                const lastSegment = segments[segments.length - 1];
                if (!lastSegment.includes('.')) {
                    pathname += '.resource'; // Default extension
                }
            }
            
            return 'assets/' + pathname;
        } catch (error) {
            return 'assets/unknown_resource_' + Date.now();
        }
    }
        }

    async initialize() {
        console.log('Launching browser...');
        this.browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        });
        this.page = await this.browser.newPage();
        
        // Set a reasonable viewport and user agent
        await this.page.setViewport({ width: 1920, height: 1080 });
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Set longer timeouts
        this.page.setDefaultTimeout(60000);
        this.page.setDefaultNavigationTimeout(60000);
        
        // Ensure output directory exists
        await fs.ensureDir(this.outputDir);
    }

    async scrape() {
        try {
            await this.initialize();
            
            console.log(`Starting to scrape: ${this.baseUrl}`);
            this.pendingUrls.add(this.baseUrl);
            
            while (this.pendingUrls.size > 0) {
                const currentUrl = this.pendingUrls.values().next().value;
                this.pendingUrls.delete(currentUrl);
                
                if (this.visitedUrls.has(currentUrl)) {
                    continue;
                }
                
                await this.scrapePage(currentUrl);
                this.visitedUrls.add(currentUrl);
                
                console.log(`Scraped: ${currentUrl} (${this.visitedUrls.size} pages completed, ${this.pendingUrls.size} pending)`);
                
                // Add a small delay to be respectful to the server
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            console.log(`\\nScraping completed! ${this.visitedUrls.size} pages scraped.`);
            console.log(`Files saved to: ${path.resolve(this.outputDir)}`);
            
        } catch (error) {
            console.error('Error during scraping:', error);
        } finally {
            if (this.browser) {
                await this.browser.close();
            }
        }
    }

    async scrapePage(url) {
        try {
            console.log(`Loading page: ${url}`);
            
            // Navigate to the page with better error handling
            await this.page.goto(url, { 
                waitUntil: 'domcontentloaded',
                timeout: 60000 
            });

            // Wait a bit for dynamic content to load
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Extract all links from the page before modifying content
            const links = await this.page.evaluate(() => {
                const anchors = Array.from(document.querySelectorAll('a[href]'));
                return anchors.map(anchor => {
                    const href = anchor.getAttribute('href');
                    if (href) {
                        // Convert relative URLs to absolute URLs
                        try {
                            return new URL(href, window.location.href).href;
                        } catch (e) {
                            return null;
                        }
                    }
                    return null;
                }).filter(link => link !== null);
            });

            console.log(`Found ${links.length} links on ${url}`);

            // Filter and add new URLs to pending list
            let newLinksAdded = 0;
            for (const link of links) {
                if (this.shouldScrapeUrl(link)) {
                    this.pendingUrls.add(link);
                    newLinksAdded++;
                }
            }
            
            console.log(`Added ${newLinksAdded} new URLs to scrape queue`);

            // Get the page content and modify links
            const content = await this.page.evaluate((baseDomain) => {
                // Helper function to convert URL to file path (injected)
                function urlToFilePath(url) {
                    try {
                        const urlObj = new URL(url);
                        let pathname = urlObj.pathname;
                        
                        // Remove leading slash
                        if (pathname.startsWith('/')) {
                            pathname = pathname.substring(1);
                        }
                        
                        // If pathname is empty or ends with '/', treat as index
                        if (!pathname || pathname.endsWith('/')) {
                            pathname += 'index';
                        }
                        
                        // Replace invalid filename characters
                        pathname = pathname.replace(/[<>:"|?*]/g, '_');
                        
                        // Add query parameters to filename if they exist
                        if (urlObj.search) {
                            const queryString = urlObj.search.substring(1).replace(/[<>:"|?*&=]/g, '_');
                            pathname += '_' + queryString;
                        }
                        
                        return pathname;
                    } catch (error) {
                        return 'unknown_page';
                    }
                }

                // Replace all absolute URLs with relative paths
                const anchors = document.querySelectorAll('a[href]');
                anchors.forEach(anchor => {
                    const href = anchor.getAttribute('href');
                    if (href && href.includes(baseDomain)) {
                        try {
                            const relativePath = urlToFilePath(href) + '.html';
                            anchor.setAttribute('href', relativePath);
                        } catch (error) {
                            console.log('Error processing link:', href, error);
                        }
                    }
                });

                return document.documentElement.outerHTML;
            }, this.baseDomain);

            // Save the modified content
            const filePath = this.urlToFilePath(url);
            const fullPath = path.join(this.outputDir, filePath + '.html');
            
            await fs.ensureDir(path.dirname(fullPath));
            await fs.writeFile(fullPath, content, 'utf8');
            
            console.log(`Saved: ${fullPath}`);

        } catch (error) {
            console.error(`Error scraping ${url}:`, error.message);
            
            // Even if there's an error, try to save what we can get
            try {
                const basicContent = `<!DOCTYPE html>
<html>
<head>
    <title>Error loading page</title>
</head>
<body>
    <h1>Error loading page: ${url}</h1>
    <p>Error: ${error.message}</p>
    <p>This page could not be loaded during scraping.</p>
</body>
</html>`;
                
                const filePath = this.urlToFilePath(url);
                const fullPath = path.join(this.outputDir, filePath + '.html');
                await fs.ensureDir(path.dirname(fullPath));
                await fs.writeFile(fullPath, basicContent, 'utf8');
                console.log(`Saved error page: ${fullPath}`);
            } catch (saveError) {
                console.error(`Could not save error page for ${url}:`, saveError.message);
            }
        }
    }

    shouldScrapeUrl(url) {
        try {
            const urlObj = new URL(url);
            
            // Only scrape URLs from the same domain
            if (urlObj.hostname !== this.baseDomain) {
                return false;
            }
            
            // Skip already visited URLs
            if (this.visitedUrls.has(url)) {
                return false;
            }
            
            // Skip URLs that are already pending
            if (this.pendingUrls.has(url)) {
                return false;
            }
            
            // Skip certain file types
            const skipExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.css', '.js', '.ico', '.svg', '.zip', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'];
            const pathname = urlObj.pathname.toLowerCase();
            if (skipExtensions.some(ext => pathname.endsWith(ext))) {
                return false;
            }
            
            // Skip mailto, tel, and other non-http protocols
            if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
                return false;
            }
            
            // Skip anchors that point to the same page (just different sections)
            if (urlObj.hash && urlObj.pathname === new URL(this.baseUrl).pathname && !urlObj.search) {
                return false;
            }
            
            return true;
        } catch (error) {
            return false;
        }
    }

    urlToFilePath(url) {
        try {
            const urlObj = new URL(url);
            let pathname = urlObj.pathname;
            
            // Remove leading slash
            if (pathname.startsWith('/')) {
                pathname = pathname.substring(1);
            }
            
            // If pathname is empty or ends with '/', treat as index
            if (!pathname || pathname.endsWith('/')) {
                pathname += 'index';
            }
            
            // Replace invalid filename characters
            pathname = pathname.replace(/[<>:"|?*]/g, '_');
            
            // Add query parameters to filename if they exist
            if (urlObj.search) {
                const queryString = urlObj.search.substring(1).replace(/[<>:"|?*&=]/g, '_');
                pathname += '_' + queryString;
            }
            
            return pathname;
        } catch (error) {
            return 'unknown_page';
        }
    }
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('Usage: node index.js <website-url> [output-directory]');
        console.log('Example: node index.js https://climate-adapt.eea.europa.eu/ my-scraped-site');
        process.exit(1);
    }
    
    const websiteUrl = args[0];
    const outputDir = args[1] || 'scraped-site';
    
    console.log(`Starting website scraper...`);
    console.log(`Target URL: ${websiteUrl}`);
    console.log(`Output directory: ${outputDir}`);
    console.log('');
    
    const scraper = new WebsiteScraper(websiteUrl, outputDir);
    await scraper.scrape();
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\\nReceived SIGINT, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\\nReceived SIGTERM, shutting down gracefully...');
    process.exit(0);
});

if (require.main === module) {
    main().catch(console.error);
}

module.exports = WebsiteScraper;
