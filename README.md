# Website Scraper

A Node.js project that uses Puppeteer to scrape websites and create offline browsable copies.

## Features

- Scrapes all pages from a specified domain
- **Downloads all resources**: CSS files, images, JavaScript, fonts, and other assets
- **Converts absolute URLs to relative paths** for offline browsing
- **Updates resource links** to point to downloaded local copies
- Maintains the website structure and navigation
- Handles dynamic content loading
- Saves pages as HTML files with modified links
- **Creates an `assets/` folder** with all downloaded resources

## Installation

1. Install dependencies:
```bash
npm install
```

## Usage

### Basic Usage
```bash
npm start <website-url> [output-directory]
```

### Examples
```bash
# Scrape the climate-adapt website to default directory 'scraped-site'
npm start https://climate-adapt.eea.europa.eu/

# Scrape to a custom directory
npm start https://climate-adapt.eea.europa.eu/ climate-adapt-offline

# Run directly with node
node index.js https://climate-adapt.eea.europa.eu/ my-output-folder
```

## How it Works

1. **Page Discovery**: The scraper starts with the provided URL and discovers new pages by following links
2. **Resource Discovery**: On each page, it finds all CSS files, images, JavaScript files, and other resources
3. **Resource Download**: Downloads all resources from the same domain to a local `assets/` folder
4. **Content Modification**: Each page's HTML is modified to:
   - Replace absolute URLs with relative paths for internal links
   - Update resource URLs to point to downloaded local files
5. **File Structure**: Pages are saved maintaining the original URL structure as file paths
6. **Offline Navigation**: Modified links allow browsing the scraped content offline with full styling and images

## Configuration

The scraper includes several built-in configurations:

- **Domain Restriction**: Only scrapes pages from the same domain as the starting URL
- **File Type Filtering**: Skips certain file types (PDF, images, CSS, JS) to focus on HTML content
- **Duplicate Prevention**: Tracks visited URLs to avoid scraping the same page twice

## Output Structure

The scraped website will be saved in the specified output directory with the following structure:
```
output-directory/
├── index.html (homepage)
├── page1.html
├── subfolder/
│   ├── index.html
│   └── page2.html
├── assets/
│   ├── css/
│   │   ├── styles.css
│   │   └── theme.css
│   ├── images/
│   │   ├── logo.png
│   │   └── background.jpg
│   ├── js/
│   │   └── scripts.js
│   └── fonts/
│       └── custom-font.woff2
└── ...
```

## Limitations

- Only downloads resources from the same domain as the target website
- Large websites may take considerable time to scrape
- Some dynamic content may not be captured if it requires user interaction
- Resources larger than 30MB may timeout during download

## Development

To run in development mode with auto-restart:
```bash
npm run dev
```

## Notes

- The scraper respects the website's structure and only follows internal links
- Pages are saved with `.html` extension regardless of original URL structure
- Query parameters in URLs are converted to underscores in filenames
- The scraper uses a headless Chrome browser via Puppeteer
