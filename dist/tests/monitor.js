"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const playwright_1 = require("playwright");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const nodemailer = __importStar(require("nodemailer"));
// Utility function to check if all keywords are present in a text
function matchesAllKeywords(text, keywords) {
    return keywords.every(keyword => text.toLowerCase().includes(keyword.toLowerCase()));
}
// Utility function to parse price string to number
function parsePrice(priceText) {
    return parseFloat(priceText.replace(/[^\d,]/g, '').replace(',', '.'));
}
// Add this helper function near the top (after imports):
async function getStableResultCountFlexible(page, selector, regex, multiple = false) {
    let lastCount = 0;
    for (let i = 0; i < 3; i++) {
        let count = 0;
        if (multiple) {
            const elements = await page.locator(selector).all();
            for (const el of elements) {
                const text = await el.innerText();
                const match = text.match(regex);
                if (match) {
                    count = parseInt(match[1], 10);
                    break;
                }
            }
        }
        else {
            const text = await page.locator(selector).innerText();
            const match = text.match(regex);
            count = match ? parseInt(match[1], 10) : 0;
        }
        if (count === lastCount && count !== 0)
            return count;
        lastCount = count;
        await page.waitForTimeout(1000);
    }
    return lastCount;
}
// Generalized product info extraction
async function extractProductInfo(cards, selectors, searchKeywords) {
    let minPrice = Number.POSITIVE_INFINITY;
    let bestProduct = { productName: '', price: '', availability: '' };
    const count = await cards.count();
    for (let i = 0; i < count; i++) {
        const card = cards.nth(i);
        const productName = await card.locator(selectors.name).innerText();
        if (searchKeywords && searchKeywords.length > 0 && !matchesAllKeywords(productName, searchKeywords)) {
            continue;
        }
        let priceText = 'Price not found';
        try {
            priceText = await card.locator(selectors.price).first().innerText();
        }
        catch { }
        const priceNumber = parsePrice(priceText);
        let availability = 'Stock status not found';
        try {
            availability = await card.locator(selectors.availability).first().innerText();
        }
        catch { }
        if (!isNaN(priceNumber) && priceNumber < minPrice) {
            minPrice = priceNumber;
            bestProduct = { productName, price: priceText, availability };
        }
    }
    return bestProduct;
}
class ProductPage {
    constructor(page, selectors) {
        this.page = page;
        this.selectors = selectors;
    }
    async search(productName, searchInputSelector) {
        const searchInput = this.page.locator(searchInputSelector);
        await searchInput.fill(productName);
        await searchInput.press('Enter');
    }
    async autoScroll(cardSelector) {
        let previousCount = 0;
        let sameCountTimes = 0;
        let scrollStep = 500;
        let maxScrolls = 100;
        let scrolls = 0;
        while (sameCountTimes < 2 && scrolls < maxScrolls) {
            const count = await this.page.locator(cardSelector).count();
            if (count === previousCount) {
                sameCountTimes++;
            }
            else {
                sameCountTimes = 0;
                previousCount = count;
            }
            await this.page.evaluate((step) => {
                window.scrollBy(0, step);
            }, scrollStep);
            await this.page.waitForTimeout(1200);
            scrolls++;
        }
        return previousCount;
    }
    async getProductInfo(site, searchKeywords) {
        if (site === 'teknosa') {
            await this.page.waitForSelector('div#product-item.prd');
            await this.autoScroll('div#product-item.prd');
            const cards = this.page.locator('div#product-item.prd');
            console.log('[Teknosa] Total product cards inspected:', await cards.count());
            return extractProductInfo(cards, this.selectors, searchKeywords);
        }
        else {
            await this.page.waitForSelector('article[data-test="mms-product-card"]');
            await this.autoScroll('article[data-test="mms-product-card"]');
            const cards = this.page.locator('article[data-test="mms-product-card"]');
            console.log('[MediaMarkt] Total product cards inspected:', await cards.count());
            return extractProductInfo(cards, this.selectors, searchKeywords);
        }
    }
}
const PRODUCTS = [
    {
        url: 'https://www.mediamarkt.com.tr/',
        searchInputSelector: '#search-form',
        selectors: {
            name: 'p[data-test="product-title"]',
            price: 'div[data-test="mms-price"] span',
            availability: 'p.czlxPt',
        },
        cardSelector: 'article[data-test="mms-product-card"]',
        countText: 'section[data-test="mms-search-srp-headlayout"] h1 + span',
        countRegex: /(\d+)\s*ürün/,
        multiple: false
    },
    {
        url: 'https://www.teknosa.com/',
        searchInputSelector: '#search-input',
        selectors: {
            name: 'h3.prd-title',
            price: '.prc.prc-third, .prc.prc-last',
            availability: 'p.product-stock-status',
        },
        cardSelector: 'div#product-item.prd',
        countText: '.plp-info',
        countRegex: /(\d+)/,
        multiple: false
    },
];
const DATA_FILE = path.resolve(__dirname, 'productDataHistory.json');
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});
async function sendEmail(subject, text) {
    await transporter.sendMail({
        from: `"Price Monitor" <${process.env.SMTP_USER}>`,
        to: process.env.MAIL_TO,
        subject,
        text,
    });
}
async function closeCookieBar(page) {
    try {
        if (await page.locator('#pwa-consent-layer-accept-all-button').count() > 0) {
            await page.locator('#pwa-consent-layer-accept-all-button').click();
            await page.waitForTimeout(500);
        }
    }
    catch { }
    try {
        if (await page.locator('[data-test="cookie-bar-agree-button"]').count() > 0) {
            await page.locator('[data-test="cookie-bar-agree-button"]').click();
            await page.waitForTimeout(500);
        }
    }
    catch { }
    try {
        if (await page.locator('div:text("Kabul Et")').count() > 0) {
            await page.locator('div:text("Kabul Et")').first().click();
            await page.waitForTimeout(500);
        }
    }
    catch { }
}
async function scrapeProductData(context, product, searchKeywords) {
    const page = await context.newPage();
    await page.goto(product.url);
    await closeCookieBar(page);
    const productPage = new ProductPage(page, product.selectors);
    await productPage.search(searchKeywords.join(' '), product.searchInputSelector);
    // Log product count after search
    try {
        const resultCount = await getStableResultCountFlexible(page, product.countText, product.countRegex, product.multiple);
        console.log(`[${product.url.includes('teknosa') ? 'Teknosa' : 'MediaMarkt'}] Total search result:`, resultCount);
        if (resultCount === 0) {
            console.log(`Warning: ${product.url.includes('teknosa') ? 'Teknosa' : 'MediaMarkt'} returned 0 results. This may indicate a loading or scraping issue.`);
        }
    }
    catch (e) {
        console.log('Product count not found:', e);
    }
    const site = product.url.includes('teknosa') ? 'teknosa' : 'mediamarkt';
    const { productName, price, availability } = await productPage.getProductInfo(site, searchKeywords);
    await page.close();
    return { url: product.url, productName, price, availability, timestamp: new Date().toISOString() };
}
function loadHistory() {
    if (fs.existsSync(DATA_FILE)) {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }
    return {};
}
function saveHistory(history) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(history, null, 2));
}
function detectChanges(oldData, newData) {
    const changes = [];
    if (!oldData)
        return ['New product added to monitoring'];
    if (oldData.price !== newData.price) {
        changes.push(`Price changed from ${oldData.price} to ${newData.price}`);
    }
    if (oldData.availability !== newData.availability) {
        changes.push(`Availability changed from "${oldData.availability}" to "${newData.availability}"`);
    }
    return changes;
}
const ENABLE_EMAIL = false;
async function main() {
    // Launch browser in headed mode for local debugging. Change to headless: true for CI environments.
    const browser = await playwright_1.chromium.launch({ headless: false });
    const context = await browser.newContext();
    const history = loadHistory();
    const searchKeywords = ["iphone", "16", "pro", "max"];
    for (const product of PRODUCTS) {
        const newData = await scrapeProductData(context, product, searchKeywords);
        const oldData = history[product.url];
        const changes = detectChanges(oldData, newData);
        if (changes.length > 0) {
            console.log(`Changes detected for ${product.url}:`);
            changes.forEach(change => console.log(` - ${change}`));
            if (ENABLE_EMAIL) {
                await sendEmail(`Product Update: ${newData.productName}`, `Changes detected:\n${changes.join('\n')}\n\nDetails:\n${JSON.stringify(newData, null, 2)}`);
            }
        }
        else {
            console.log(`No changes for ${product.url}`);
        }
        history[product.url] = newData;
    }
    saveHistory(history);
    await browser.close();
}
main().catch(console.error);
