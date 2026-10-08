import asyncio
from playwright.async_api import async_playwright
import os

async def run_verification():
    os.makedirs("verification_screenshots", exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)

        # 1. Desktop Viewport
        page = await browser.new_page(viewport={"width": 1280, "height": 800})

        # Test index.html
        await page.goto("http://localhost:8000/index.html")
        await page.wait_for_timeout(1000)
        await page.screenshot(path="verification_screenshots/index_desktop.png")

        # Test resultados.html
        await page.goto("http://localhost:8000/resultados.html?ubicacion=Balcarce")
        await page.wait_for_timeout(2000)
        await page.screenshot(path="verification_screenshots/resultados_desktop.png")

        # Test forestal.html
        await page.goto("http://localhost:8000/forestal.html")
        await page.wait_for_timeout(2000)
        await page.screenshot(path="verification_screenshots/forestal_desktop.png")

        # 2. Mobile Viewport (iPhone 12 / Android equivalent)
        mobile_page = await browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True)

        await mobile_page.goto("http://localhost:8000/index.html")
        await mobile_page.wait_for_timeout(1000)
        await mobile_page.screenshot(path="verification_screenshots/index_mobile.png")

        await mobile_page.goto("http://localhost:8000/resultados.html?ubicacion=R%C3%ADo%20Cuarto")
        await mobile_page.wait_for_timeout(2000)
        await mobile_page.screenshot(path="verification_screenshots/resultados_mobile.png")

        await mobile_page.goto("http://localhost:8000/forestal.html")
        await mobile_page.wait_for_timeout(2000)
        await mobile_page.screenshot(path="verification_screenshots/forestal_mobile.png")

        await browser.close()
        print("Verification completed. Screenshots saved in verification_screenshots/")

if __name__ == "__main__":
    asyncio.run(run_verification())
