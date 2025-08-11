const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');
const { URL } = require('url');
const https = require('https');
const http = require('http');
const zlib = require('zlib');

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
        this.sitemap = new Map(); // URL -> { title, links, resources, timestamp }
    }

    async downloadResource(url, outputPath, page = null) {
        if (this.downloadedResources.has(url)) {
            console.log(`Skipping already downloaded: ${path.basename(outputPath)}`);
            return true; // Already downloaded
        }

        // Check if file already exists on disk
        try {
            await fs.access(outputPath);
            console.log(`File already exists: ${path.basename(outputPath)}`);
            this.downloadedResources.add(url);
            return true;
        } catch (error) {
            // File doesn't exist, proceed with download
        }

        try {
            const urlObj = new URL(url);
            const protocol = urlObj.protocol === 'https:' ? https : http;
            
            await fs.ensureDir(path.dirname(outputPath));
            
            console.log(`Starting download: ${url} -> ${outputPath}`);
            
            return new Promise(async (resolve, reject) => {
                const file = fs.createWriteStream(outputPath);
                
                // Get cookies from current browser session if page is available
                let cookieHeader = '';
                if (page) {
                    try {
                        const cookies = await page.cookies(url);
                        if (cookies.length > 0) {
                            cookieHeader = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
                        }
                    } catch (cookieError) {
                        console.log(`Could not get cookies for ${url}: ${cookieError.message}`);
                    }
                }
                
                const headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/css,*/*;q=0.1',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1'
                };
                
                if (cookieHeader) {
                    headers['Cookie'] = cookieHeader;
                }
                
                const request = protocol.get(url, { headers }, (response) => {
                    if (response.statusCode === 200) {
                        let downloadedBytes = 0;
                        let stream = response;
                        
                        // Handle gzip compression
                        const encoding = response.headers['content-encoding'];
                        if (encoding === 'gzip') {
                            console.log(`  Decompressing gzip content for: ${path.basename(outputPath)}`);
                            stream = response.pipe(zlib.createGunzip());
                        } else if (encoding === 'deflate') {
                            console.log(`  Decompressing deflate content for: ${path.basename(outputPath)}`);
                            stream = response.pipe(zlib.createInflate());
                        } else if (encoding === 'br') {
                            console.log(`  Decompressing brotli content for: ${path.basename(outputPath)}`);
                            stream = response.pipe(zlib.createBrotliDecompress());
                        }
                        
                        stream.on('data', (chunk) => {
                            downloadedBytes += chunk.length;
                        });
                        
                        stream.pipe(file);
                        file.on('finish', () => {
                            file.close();
                            this.downloadedResources.add(url);
                            console.log(`Downloaded resource: ${path.basename(outputPath)} (${downloadedBytes} bytes, ${response.headers['content-type'] || 'unknown type'})`);
                            resolve(true);
                        });
                        
                        stream.on('error', (err) => {
                            file.close();
                            fs.unlink(outputPath).catch(() => {}); // Clean up on error
                            reject(err);
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
                        console.log(`Failed to download ${url}: HTTP ${response.statusCode}`);
                        file.close();
                        fs.unlink(outputPath).catch(() => {}); // Clean up empty file
                        resolve(false);
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

    async processCssFile(cssFilePath, originalCssUrl) {
        try {
            const cssContent = await fs.readFile(cssFilePath, 'utf8');
            const cssBaseUrl = new URL(originalCssUrl).href;
            
            console.log(`Processing CSS file: ${cssFilePath}`);
            
            // Find all url() references in CSS - fixed regex pattern
            const urlMatches = cssContent.match(/url\(['"]?([^'")]+)['"]?\)/g);
            if (urlMatches) {
                console.log(`Found ${urlMatches.length} url() references in CSS`);
                let modifiedCss = cssContent;
                
                for (const match of urlMatches) {
                    const url = match.replace(/url\(['"]?([^'")]+)['"]?\)/, '$1');
                    try {
                        const absoluteUrl = new URL(url, cssBaseUrl).href;
                        const resourceUrl = new URL(absoluteUrl);
                        
                        // Only download from same domain
                        if (resourceUrl.hostname === new URL(originalCssUrl).hostname) {
                            const localPath = this.getResourcePath(absoluteUrl);
                            const fullPath = path.join(this.outputDir, localPath);
                            
                            console.log(`  Downloading CSS resource: ${absoluteUrl} -> ${localPath}`);
                            
                            if (await this.downloadResource(absoluteUrl, fullPath, this.page)) {
                                // Update the CSS content with the local path
                                const relativePath = path.relative(path.dirname(cssFilePath), fullPath).replace(/\\/g, '/');
                                modifiedCss = modifiedCss.replace(match, `url('${relativePath}')`);
                                console.log(`  Updated CSS reference: ${url} -> ${relativePath}`);
                            } else {
                                console.log(`  Failed to download CSS resource: ${absoluteUrl}`);
                            }
                        } else {
                            console.log(`  Skipping external CSS resource: ${absoluteUrl}`);
                        }
                    } catch (error) {
                        console.error(`Error processing CSS URL ${url}:`, error.message);
                    }
                }
                
                // Write back the modified CSS if it changed
                if (modifiedCss !== cssContent) {
                    await fs.writeFile(cssFilePath, modifiedCss, 'utf8');
                    console.log(`Updated CSS file: ${cssFilePath}`);
                } else {
                    console.log(`No changes needed for CSS file: ${cssFilePath}`);
                }
            } else {
                console.log(`No url() references found in CSS file: ${cssFilePath}`);
            }
        } catch (error) {
            console.error(`Error processing CSS file ${cssFilePath}:`, error.message);
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
            
            // Fix nested assets issue - remove any existing 'assets/' prefix
            if (pathname.startsWith('assets/')) {
                pathname = pathname.substring(7);
            }
            
            // Replace invalid filename characters
            pathname = pathname.replace(/[<>:"|?*]/g, '_');
            
            // Ensure we have a file extension
            if (!path.extname(pathname)) {
                // Try to guess extension from URL or use a default
                const segments = pathname.split('/');
                const lastSegment = segments[segments.length - 1];
                if (!lastSegment.includes('.') && lastSegment.length > 0) {
                    // Try to determine file type from the URL path
                    if (pathname.includes('/css/') || pathname.includes('stylesheet') || pathname.includes('.css')) {
                        pathname += '.css';
                    } else if (pathname.includes('/js/') || pathname.includes('javascript') || pathname.includes('.js')) {
                        pathname += '.js';
                    } else if (pathname.includes('/img/') || pathname.includes('/images/') || pathname.includes('image')) {
                        pathname += '.png'; // Default image extension
                    } else if (pathname.includes('/pdf/') || pathname.includes('document')) {
                        pathname += '.pdf';
                    } else if (pathname.includes('/video/') || pathname.includes('mp4')) {
                        pathname += '.mp4';
                    } else if (pathname.includes('/audio/') || pathname.includes('mp3')) {
                        pathname += '.mp3';
                    } else {
                        pathname += '.resource'; // Default extension
                    }
                }
            }
            
            // Add query parameters to filename if they exist (to make unique files)
            if (urlObj.search) {
                const ext = path.extname(pathname);
                const name = pathname.slice(0, -ext.length);
                const queryString = urlObj.search.substring(1).replace(/[<>:"|?*&=]/g, '_');
                pathname = name + '_' + queryString + ext;
            }
            
            return 'assets/' + pathname;
        } catch (error) {
            return 'assets/unknown_resource_' + Date.now();
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
        await fs.ensureDir(path.join(this.outputDir, 'assets'));
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
            
            // Generate sitemap
            await this.generateSitemap();
            
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
            const pageData = await this.page.evaluate(() => {
                const anchors = Array.from(document.querySelectorAll('a[href]'));
                const links = anchors.map(anchor => {
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
                
                // Get page title
                const title = document.title || 'Untitled Page';
                
                return { links, title };
            });

            console.log(`Found ${pageData.links.length} links on ${url}`);
            console.log(`Page title: ${pageData.title}`);

            // Filter and add new URLs to pending list
            let newLinksAdded = 0;
            for (const link of pageData.links) {
                if (this.shouldScrapeUrl(link)) {
                    // Clean the URL before adding to pending list
                    const linkObj = new URL(link);
                    const cleanUrl = `${linkObj.protocol}//${linkObj.hostname}${linkObj.pathname}${linkObj.search}`;
                    this.pendingUrls.add(cleanUrl);
                    newLinksAdded++;
                }
            }
            
            console.log(`Added ${newLinksAdded} new URLs to scrape queue`);

            // Extract all resource URLs (CSS, images, scripts, etc.)
            const resources = await this.page.evaluate(() => {
                const resourceUrls = [];
                
                // CSS files
                document.querySelectorAll('link[rel="stylesheet"][href]').forEach(link => {
                    const href = link.getAttribute('href');
                    if (href) {
                        try {
                            resourceUrls.push({
                                url: new URL(href, window.location.href).href,
                                type: 'css',
                                element: 'link',
                                attribute: 'href'
                            });
                        } catch (e) {}
                    }
                });
                
                // All other link tags (favicons, manifests, etc.)
                document.querySelectorAll('link[href]:not([rel="stylesheet"])').forEach(link => {
                    const href = link.getAttribute('href');
                    if (href) {
                        try {
                            resourceUrls.push({
                                url: new URL(href, window.location.href).href,
                                type: 'other',
                                element: 'link',
                                attribute: 'href'
                            });
                        } catch (e) {}
                    }
                });
                
                // Images with src
                document.querySelectorAll('img[src]').forEach(img => {
                    const src = img.getAttribute('src');
                    if (src) {
                        try {
                            resourceUrls.push({
                                url: new URL(src, window.location.href).href,
                                type: 'image',
                                element: 'img',
                                attribute: 'src'
                            });
                        } catch (e) {}
                    }
                });
                
                // Images with srcset
                document.querySelectorAll('img[srcset]').forEach(img => {
                    const srcset = img.getAttribute('srcset');
                    if (srcset) {
                        // Parse srcset - it can contain multiple URLs
                        const urls = srcset.split(',').map(s => s.trim().split(' ')[0]);
                        urls.forEach(url => {
                            if (url) {
                                try {
                                    resourceUrls.push({
                                        url: new URL(url, window.location.href).href,
                                        type: 'image',
                                        element: 'img',
                                        attribute: 'srcset'
                                    });
                                } catch (e) {}
                            }
                        });
                    }
                });
                
                // Background images in CSS
                document.querySelectorAll('[style*="background"]').forEach(element => {
                    const style = element.getAttribute('style');
                    if (style) {
                        const matches = style.match(/url\(['"]?([^'")]+)['"]?\)/g);
                        if (matches) {
                            matches.forEach(match => {
                                const url = match.replace(/url\(['"]?([^'")]+)['"]?\)/, '$1');
                                try {
                                    resourceUrls.push({
                                        url: new URL(url, window.location.href).href,
                                        type: 'image',
                                        element: 'style',
                                        attribute: 'style'
                                    });
                                } catch (e) {}
                            });
                        }
                    }
                });
                
                // JavaScript files
                document.querySelectorAll('script[src]').forEach(script => {
                    const src = script.getAttribute('src');
                    if (src) {
                        try {
                            resourceUrls.push({
                                url: new URL(src, window.location.href).href,
                                type: 'js',
                                element: 'script',
                                attribute: 'src'
                            });
                        } catch (e) {}
                    }
                });
                
                // Video and audio sources
                document.querySelectorAll('video[src], audio[src]').forEach(media => {
                    const src = media.getAttribute('src');
                    if (src) {
                        try {
                            resourceUrls.push({
                                url: new URL(src, window.location.href).href,
                                type: 'media',
                                element: media.tagName.toLowerCase(),
                                attribute: 'src'
                            });
                        } catch (e) {}
                    }
                });
                
                // Source elements within video/audio
                document.querySelectorAll('source[src]').forEach(source => {
                    const src = source.getAttribute('src');
                    if (src) {
                        try {
                            resourceUrls.push({
                                url: new URL(src, window.location.href).href,
                                type: 'media',
                                element: 'source',
                                attribute: 'src'
                            });
                        } catch (e) {}
                    }
                });
                
                // PDF and document links
                document.querySelectorAll('a[href]').forEach(link => {
                    const href = link.getAttribute('href');
                    if (href) {
                        try {
                            const url = new URL(href, window.location.href).href;
                            const ext = url.split('.').pop().toLowerCase().split('?')[0];
                            if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar', 'mp4', 'mp3', 'wav', 'avi', 'mov', 'wmv', 'flv', 'webm', 'ogg'].includes(ext)) {
                                resourceUrls.push({
                                    url: url,
                                    type: 'document',
                                    element: 'a',
                                    attribute: 'href'
                                });
                            }
                        } catch (e) {}
                    }
                });
                
                return resourceUrls;
            });

            console.log(`Found ${resources.length} resources to download`);

            // Download resources from the same domain
            const resourceMap = new Map();
            let downloadedCount = 0;
            
            // First, filter unique resources to avoid duplicate downloads
            const uniqueResources = new Map();
            for (const resource of resources) {
                if (!uniqueResources.has(resource.url)) {
                    uniqueResources.set(resource.url, resource);
                }
            }
            
            console.log(`Found ${uniqueResources.size} unique resources (filtered from ${resources.length} total)`);
            
            for (const [resourceUrl, resource] of uniqueResources) {
                try {
                    const resourceUrlObj = new URL(resource.url);
                    const currentPageUrl = new URL(url);
                    
                    // Download if it's from the same domain
                    if (resourceUrlObj.hostname === currentPageUrl.hostname) {
                        const localPath = this.getResourcePath(resource.url);
                        const fullPath = path.join(this.outputDir, localPath);
                        
                        console.log(`Downloading: ${resource.url} -> ${localPath}`);
                        
                        if (await this.downloadResource(resource.url, fullPath, this.page)) {
                            resourceMap.set(resource.url, localPath);
                            downloadedCount++;
                            
                            // If it's a CSS file, process it for additional resources
                            if (resource.type === 'css' && localPath.endsWith('.css')) {
                                console.log(`  Processing CSS file for additional resources: ${fullPath}`);
                                try {
                                    await this.processCssFile(fullPath, resource.url);
                                } catch (cssError) {
                                    console.error(`  Error processing CSS file ${fullPath}:`, cssError.message);
                                }
                            }
                        }
                    } else {
                        console.log(`Skipping external resource: ${resource.url}`);
                    }
                } catch (error) {
                    console.error(`Error processing resource ${resourceUrl}:`, error.message);
                }
            }
            
            console.log(`Downloaded ${downloadedCount} resources successfully`);

            // Store sitemap data for this page
            this.sitemap.set(url, {
                title: pageData.title,
                links: pageData.links,
                resources: Array.from(resourceMap.keys()),
                timestamp: new Date().toISOString()
            });

            // Process CSS files after all resources are downloaded
            console.log('Processing CSS files for background images...');
            for (const [resourceUrl, localPath] of resourceMap) {
                if (localPath.endsWith('.css')) {
                    const fullPath = path.join(this.outputDir, localPath);
                    await this.processCssFile(fullPath, resourceUrl);
                }
            }

            // Get the page content and modify links
            const content = await this.page.evaluate((baseDomain, resourceMapping, currentPagePath) => {
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

                // Replace all absolute URLs with relative paths for same-domain links
                const anchors = document.querySelectorAll('a[href]');
                anchors.forEach(anchor => {
                    const href = anchor.getAttribute('href');
                    if (href) {
                        try {
                            // Convert to absolute URL to properly check domain
                            const absoluteUrl = new URL(href, window.location.href);
                            
                            // Only convert same-domain links to relative paths
                            if (absoluteUrl.hostname === baseDomain) {
                                let relativePath = urlToFilePath(absoluteUrl.href);
                                
                                // Only add .html if it doesn't already end with .html
                                if (!relativePath.endsWith('.html')) {
                                    relativePath += '.html';
                                }
                                
                                anchor.setAttribute('href', relativePath);
                                console.log(`Replaced link: ${href} -> ${relativePath}`);
                            }
                        } catch (error) {
                            console.log('Error processing link:', href, error);
                        }
                    }
                });

                // Replace resource URLs with local paths - more comprehensive approach
                console.log('Resource mapping entries:', Object.keys(resourceMapping).length);
                
                // Create a map of all possible URL variations to local paths
                const urlVariations = new Map();
                for (const [originalUrl, localPath] of Object.entries(resourceMapping)) {
                    // Add the full URL
                    urlVariations.set(originalUrl, localPath);
                    
                    // Add variations without protocol
                    const withoutProtocol = originalUrl.replace(/^https?:/, '');
                    urlVariations.set(withoutProtocol, localPath);
                    
                    // Add just the pathname part
                    try {
                        const urlObj = new URL(originalUrl);
                        urlVariations.set(urlObj.pathname, localPath);
                        
                        // Add pathname with query if it exists
                        if (urlObj.search) {
                            urlVariations.set(urlObj.pathname + urlObj.search, localPath);
                        }
                    } catch (e) {}
                }

                // Function to replace URLs in attributes
                function replaceUrlInAttribute(element, attribute) {
                    const originalValue = element.getAttribute(attribute);
                    if (!originalValue) return false;
                    
                    let replacedCount = 0;
                    
                    // Helper function to make path relative to current page
                    function makeRelativePath(localPath) {
                        // Calculate how many levels deep the current page is
                        const pageDepth = currentPagePath.split('/').length - 1;
                        
                        // If we're in a subfolder, add '../' for each level
                        if (pageDepth > 0) {
                            const relativePath = '../'.repeat(pageDepth) + localPath;
                            return relativePath;
                        }
                        
                        return localPath;
                    }
                    
                    // Handle srcset specially (contains multiple URLs)
                    if (attribute === 'srcset') {
                        const srcsetParts = originalValue.split(',').map(part => part.trim());
                        let newSrcset = '';
                        
                        srcsetParts.forEach((part, index) => {
                            const [url, ...descriptor] = part.split(' ');
                            let newUrl = url;
                            
                            // Check all URL variations for replacement
                            for (const [urlVariation, localPath] of urlVariations) {
                                if (url === urlVariation || url.endsWith(urlVariation.replace(/^\//, ''))) {
                                    newUrl = makeRelativePath(localPath);
                                    replacedCount++;
                                    break;
                                }
                            }
                            
                            newSrcset += (index > 0 ? ', ' : '') + newUrl + (descriptor.length > 0 ? ' ' + descriptor.join(' ') : '');
                        });
                        
                        if (replacedCount > 0) {
                            element.setAttribute(attribute, newSrcset);
                            console.log(`Replaced ${attribute}: ${originalValue} -> ${newSrcset}`);
                            return true;
                        }
                        return false;
                    }
                    
                    // Handle style attribute (may contain multiple url() references)
                    if (attribute === 'style') {
                        let newStyle = originalValue;
                        
                        for (const [urlVariation, localPath] of urlVariations) {
                            const urlPattern = new RegExp(`url\\(['"]?${urlVariation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\)`, 'g');
                            const newStyleTest = newStyle.replace(urlPattern, `url('${makeRelativePath(localPath)}')`);
                            if (newStyleTest !== newStyle) {
                                newStyle = newStyleTest;
                                replacedCount++;
                            }
                        }
                        
                        if (replacedCount > 0) {
                            element.setAttribute(attribute, newStyle);
                            console.log(`Replaced ${attribute}: background URLs updated`);
                            return true;
                        }
                        return false;
                    }
                    
                    // Handle regular attributes (src, href, etc.)
                    // Check exact matches first
                    for (const [urlVariation, localPath] of urlVariations) {
                        if (originalValue === urlVariation) {
                            element.setAttribute(attribute, makeRelativePath(localPath));
                            console.log(`Replaced ${attribute}: ${originalValue} -> ${makeRelativePath(localPath)}`);
                            return true;
                        }
                    }
                    
                    // Check if the original value is a relative path that matches any downloaded resource
                    for (const [urlVariation, localPath] of urlVariations) {
                        try {
                            const urlObj = new URL(urlVariation);
                            const pathWithoutLeadingSlash = urlObj.pathname.replace(/^\//, '');
                            
                            // Check if the original value matches the pathname (with or without leading slash)
                            if (originalValue === urlObj.pathname || 
                                originalValue === pathWithoutLeadingSlash ||
                                originalValue.endsWith('/' + pathWithoutLeadingSlash)) {
                                element.setAttribute(attribute, makeRelativePath(localPath));
                                console.log(`Replaced ${attribute} (path match): ${originalValue} -> ${makeRelativePath(localPath)}`);
                                return true;
                            }
                        } catch (e) {}
                    }
                    
                    return false;
                }

                // Replace URLs in different types of elements
                let replacedCount = 0;
                
                // CSS files
                document.querySelectorAll('link[href]').forEach(link => {
                    if (replaceUrlInAttribute(link, 'href')) {
                        replacedCount++;
                    }
                });
                
                // Images
                document.querySelectorAll('img[src]').forEach(img => {
                    if (replaceUrlInAttribute(img, 'src')) {
                        replacedCount++;
                    }
                });
                
                // Images with srcset
                document.querySelectorAll('img[srcset]').forEach(img => {
                    if (replaceUrlInAttribute(img, 'srcset')) {
                        replacedCount++;
                    }
                });
                
                // Scripts
                document.querySelectorAll('script[src]').forEach(script => {
                    if (replaceUrlInAttribute(script, 'src')) {
                        replacedCount++;
                    }
                });
                
                // Video and audio
                document.querySelectorAll('video[src], audio[src]').forEach(media => {
                    if (replaceUrlInAttribute(media, 'src')) {
                        replacedCount++;
                    }
                });
                
                // Source elements
                document.querySelectorAll('source[src]').forEach(source => {
                    if (replaceUrlInAttribute(source, 'src')) {
                        replacedCount++;
                    }
                });
                
                // Background images in style attributes
                document.querySelectorAll('[style*="background"], [style*="url("]').forEach(element => {
                    if (replaceUrlInAttribute(element, 'style')) {
                        replacedCount++;
                    }
                });
                
                console.log(`Total URLs replaced: ${replacedCount}`);
                
                // Remove or fix problematic base tags that break relative URLs in offline browsing
                const baseTags = document.querySelectorAll('base[href]');
                baseTags.forEach(baseTag => {
                    const baseHref = baseTag.getAttribute('href');
                    console.log(`Found base tag with href: ${baseHref}`);
                    
                    // If base href is an absolute path (starts with /) or full URL, 
                    // it will break relative resource loading in offline browsing
                    if (baseHref && (baseHref.startsWith('/') || baseHref.includes('://'))) {
                        console.log(`Removing problematic base tag: ${baseHref}`);
                        baseTag.remove();
                    }
                });
                
                return document.documentElement.outerHTML;
            }, this.baseDomain, Object.fromEntries(resourceMap), this.urlToFilePath(url));

            // Save the modified content
            const filePath = this.urlToFilePath(url);
            let fileName = filePath;
            
            // Only add .html if it doesn't already end with .html
            if (!fileName.endsWith('.html')) {
                fileName += '.html';
            }
            
            const fullPath = path.join(this.outputDir, fileName);
            
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
                let fileName = filePath;
                
                // Only add .html if it doesn't already end with .html
                if (!fileName.endsWith('.html')) {
                    fileName += '.html';
                }
                
                const fullPath = path.join(this.outputDir, fileName);
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
            
            // Clean up the URL by removing hash fragments and creating a clean URL
            const cleanUrl = `${urlObj.protocol}//${urlObj.hostname}${urlObj.pathname}${urlObj.search}`;
            
            // Skip already visited URLs (check both original and clean URL)
            if (this.visitedUrls.has(url) || this.visitedUrls.has(cleanUrl)) {
                return false;
            }
            
            // Skip URLs that are already pending (check both original and clean URL)
            if (this.pendingUrls.has(url) || this.pendingUrls.has(cleanUrl)) {
                return false;
            }
            
            // Skip certain file types for page scraping (but we'll download them as resources)
            const skipExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.css', '.js', '.ico', '.svg', '.zip', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.mp4', '.mp3', '.wav', '.avi', '.mov', '.wmv', '.flv', '.webm', '.ogg'];
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
            
            // Skip URLs that end with just a hash (like "/page#")
            if (url.endsWith('#')) {
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

    async generateSitemap() {
        console.log('Generating sitemap...');
        
        // Create sitemap data
        const sitemapData = {
            baseUrl: this.baseUrl,
            domain: this.baseDomain,
            generatedAt: new Date().toISOString(),
            totalPages: this.sitemap.size,
            totalResources: this.downloadedResources.size,
            pages: []
        };
        
        // Convert sitemap to array
        for (const [url, data] of this.sitemap) {
            sitemapData.pages.push({
                url: url,
                fileName: this.urlToFilePath(url) + '.html',
                title: data.title,
                scrapedAt: data.timestamp,
                links: data.links,
                resources: data.resources,
                linkCount: data.links.length,
                resourceCount: data.resources.length
            });
        }
        
        // Sort by URL for consistency
        sitemapData.pages.sort((a, b) => a.url.localeCompare(b.url));
        
        // Save JSON sitemap
        const jsonPath = path.join(this.outputDir, 'sitemap.json');
        await fs.writeFile(jsonPath, JSON.stringify(sitemapData, null, 2), 'utf8');
        console.log(`JSON sitemap saved: ${jsonPath}`);
        
        // Generate HTML sitemap
        const htmlSitemap = this.generateHtmlSitemap(sitemapData);
        const htmlPath = path.join(this.outputDir, 'sitemap.html');
        await fs.writeFile(htmlPath, htmlSitemap, 'utf8');
        console.log(`HTML sitemap saved: ${htmlPath}`);
        
        return sitemapData;
    }
    
    generateHtmlSitemap(data) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sitemap - ${data.domain}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.6; }
        .header { background: #f4f4f4; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-bottom: 20px; }
        .stat { background: #e9e9e9; padding: 10px; border-radius: 3px; text-align: center; }
        .page { margin-bottom: 30px; border: 1px solid #ddd; padding: 15px; border-radius: 5px; }
        .page-title { font-size: 1.2em; font-weight: bold; margin-bottom: 10px; }
        .page-url { color: #666; margin-bottom: 10px; font-family: monospace; }
        .page-info { margin-bottom: 15px; }
        .links, .resources { margin-top: 10px; }
        .links h4, .resources h4 { margin: 10px 0 5px 0; color: #333; }
        .links ul, .resources ul { margin: 0; padding-left: 20px; }
        .links li, .resources li { margin: 2px 0; }
        .internal-link { color: #0066cc; }
        .external-link { color: #cc6600; }
        .resource-link { color: #009900; }
        .timestamp { color: #888; font-size: 0.9em; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Website Sitemap</h1>
        <p><strong>Domain:</strong> ${data.domain}</p>
        <p><strong>Base URL:</strong> ${data.baseUrl}</p>
        <p><strong>Generated:</strong> ${new Date(data.generatedAt).toLocaleString()}</p>
    </div>
    
    <div class="stats">
        <div class="stat">
            <div><strong>${data.totalPages}</strong></div>
            <div>Pages Scraped</div>
        </div>
        <div class="stat">
            <div><strong>${data.totalResources}</strong></div>
            <div>Resources Downloaded</div>
        </div>
        <div class="stat">
            <div><strong>${data.pages.reduce((sum, p) => sum + p.linkCount, 0)}</strong></div>
            <div>Total Links Found</div>
        </div>
    </div>
    
    <h2>Pages</h2>
    ${data.pages.map(page => `
        <div class="page">
            <div class="page-title">${page.title}</div>
            <div class="page-url">
                <a href="${page.fileName}" class="internal-link">${page.url}</a>
            </div>
            <div class="page-info">
                <span class="timestamp">Scraped: ${new Date(page.scrapedAt).toLocaleString()}</span> | 
                <strong>${page.linkCount}</strong> links | 
                <strong>${page.resourceCount}</strong> resources
            </div>
            
            ${page.links.length > 0 ? `
                <div class="links">
                    <h4>Links (${page.links.length})</h4>
                    <ul>
                        ${page.links.map(link => {
                            const isInternal = link.startsWith(data.baseUrl) || !link.includes('://');
                            const className = isInternal ? 'internal-link' : 'external-link';
                            return `<li><a href="${link}" class="${className}" target="_blank">${link}</a></li>`;
                        }).join('')}
                    </ul>
                </div>
            ` : ''}
            
            ${page.resources.length > 0 ? `
                <div class="resources">
                    <h4>Resources (${page.resources.length})</h4>
                    <ul>
                        ${page.resources.map(resource => 
                            `<li><a href="${resource}" class="resource-link" target="_blank">${resource}</a></li>`
                        ).join('')}
                    </ul>
                </div>
            ` : ''}
        </div>
    `).join('')}
</body>
</html>`;
    }
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('Usage: node index.js <website-url> [output-directory]');
        console.log('Example: node index.js https://projectgreeneo.eu/ my-scraped-site');
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
