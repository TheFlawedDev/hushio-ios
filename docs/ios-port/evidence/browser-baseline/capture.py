import json
from pathlib import Path
from playwright.sync_api import sync_playwright
out = Path(__file__).resolve().parent
out.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for name, size, scheme in [('compact-dark', {'width':375,'height':812}, 'dark'), ('large-light', {'width':430,'height':932}, 'light')]:
        context = browser.new_context(viewport=size, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme=scheme, reduced_motion='reduce', user_agent='Mozilla/5.0 (Linux; Android 14; Baseline Phone) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36')
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto('http://127.0.0.1:5173/', wait_until='networkidle', timeout=60000)
        page.screenshot(path=str(out / f'{name}-initial.png'), full_page=True)
        (out / f'{name}-initial.json').write_text(json.dumps({'url':page.url, 'viewport':size, 'requestedColorScheme':scheme, 'ua':'Android UA to select unchanged baseline phone shell; not iOS runtime', 'body':page.locator('body').inner_text(), 'pageErrors':errors, 'nativeBridge':'absent; no mock/native success responses or fabricated data'}, indent=2))
        for view in ['search', 'library', 'downloads', 'local', 'settings']:
            page.evaluate("async (name) => { const { useNavigation } = await import('/src/stores/navigation.ts'); useNavigation.getState().navigate({name}); }", view)
            page.wait_for_timeout(600)
            page.screenshot(path=str(out / f'{name}-{view}.png'), full_page=True)
            (out / f'{name}-{view}.json').write_text(json.dumps({'view':view, 'viewport':size, 'requestedColorScheme':scheme, 'body':page.locator('body').inner_text(), 'pageErrors':errors, 'nativeBridge':'absent; no mocks or fabricated data; navigated using actual store API'}, indent=2))
        context.close()
    browser.close()
