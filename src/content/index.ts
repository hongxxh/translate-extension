/* Content Script 入口：幂等注入 —— 重复注入时先把旧实例销毁，
   保证同页面永远只有一个控制器、一套监听。 */
import { TranslationController } from './TranslationController';

declare global {
  interface Window {
    __selectTrans?: TranslationController;
  }
}

if (window.__selectTrans) window.__selectTrans.destroy();

const controller = new TranslationController();
window.__selectTrans = controller;
void controller.start();
