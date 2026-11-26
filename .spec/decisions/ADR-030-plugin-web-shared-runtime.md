# ADR-030：插件网页模块共用外壳的 React 与插件开发包实例，样式随模块注入

状态：提议
日期：2026-11-25

## 背景

插件的网页部分在运行时由外壳动态加载（插件可能是第三方、单独构建）。如果每个插件自带一份 React 或 shadcn/ui，React 的上下文与钩子会失效，界面也会和外壳不一致（ADR-021 要求共用一套）。Tailwind 的类名只有被扫描到才会生成，外壳构建时看不到第三方插件的源码。

本条是第一期实现时按「先找最接近的已有决定，找不到就选更少人工步骤、更不容易丢数据的做法」（ADR-013）补的，待评审。

## 决策

- 外壳把 `react`、`react-dom`、`react/jsx-runtime`、`@bowerbird/plugin-sdk/web` 挂在 `globalThis.__bowerbird_shared__` 上；插件构建时这几个模块不打包，改为读这个全局对象。
- 构建命令 `bowerbird-plugin-build` 由单独的构建工具包 `@bowerbird/plugin-build` 提供，插件装成开发依赖，使用者安装时不带构建工具：打包网页入口，并用共同的主题编译插件自己用到的 Tailwind 工具类，在模块加载时注入一段 `<style data-bb-plugin>`。
- 内置插件与第三方插件走同一条构建与加载路径，外壳不扫描任何插件的源码。

## 替代方案与否决理由

- **导入映射（import map）**：浏览器支持，但 Vite 构建出来的外壳块名带哈希，映射难以稳定。
- **插件各自打包 React**：钩子与上下文跨实例失效。
- **外壳构建时扫描内置插件源码生成样式**：内置插件就多了一条第三方没有的通道，违反 ADR-003。

## 兼容影响

- knowledge/features/plugin-system.md 网页接口与界面组件一节；engineering.md 构建一节。
