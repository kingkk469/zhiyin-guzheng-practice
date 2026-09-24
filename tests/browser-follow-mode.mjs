import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}});
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{window.__micCalls=0; navigator.mediaDevices.getUserMedia=async()=>{window.__micCalls++;throw new DOMException('denied','NotAllowedError');};});
try {
 await page.goto(process.env.TEST_BASE_URL??'http://127.0.0.1:3219/zhiyin-guzheng-practice/');
 await page.getByRole('button',{name:'练习勾托指序',exact:true}).click();
 await page.getByRole('radio',{name:/跟练模式/}).check();
 await page.getByLabel('基础速度',{exact:true}).fill('120');
 await page.getByRole('button',{name:'▶ 开始练习',exact:true}).click();
 await page.getByRole('heading',{name:'跟练完成',exact:true}).waitFor({timeout:20000});
 assert.equal(await page.evaluate(()=>window.__micCalls),0);
 assert.equal(await page.locator('audio').count(),0);
 const records=await page.evaluate(()=>JSON.parse(localStorage.getItem('zhiyin-v2-records')));
 assert.equal(records[0].mode,'follow'); assert.equal(records[0].total,null);assert.equal(records[0].completed,true);
 await page.getByRole('button',{name:'戴耳机，测音准 →',exact:true}).click();
 assert.ok(await page.getByRole('radio',{name:/测音准模式/}).isChecked());
 await page.getByRole('button',{name:'▶ 开始练习',exact:true}).click();
 await page.getByText(/麦克风未授权/).waitFor();
 assert.equal(await page.evaluate(()=>window.__micCalls),1);
 assert.deepEqual(errors,[]);
 await page.screenshot({path:'outputs/practice-modes.png',fullPage:true});
 console.log('Follow completes without requesting mic; assessment requests mic and handles denial');
} finally {await browser.close();}
