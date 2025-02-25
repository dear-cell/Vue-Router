let currentRoutes = [];
let testResults = [];
let currentSort = {
  column: null,
  order: 'desc'
};

// 添加停止测试的控制变量
let isTestRunning = false;
let shouldStopTest = false;

// 获取当前页面URL
function getCurrentUrl() {
  return new Promise((resolve) => {
    chrome.devtools.inspectedWindow.eval(
      'window.location.href',
      function(result) {
        resolve(result);
      }
    );
  });
}

// 执行页面内的脚本
function executeInPage(func, ...args) {
  return new Promise((resolve) => {
    const funcStr = `(${func.toString()})(${args.map(JSON.stringify).join(',')})`;
    chrome.devtools.inspectedWindow.eval(funcStr, function(result, isException) {
      if (isException) {
        console.error('执行脚本错误:', isException);
        resolve(null);
      } else {
        resolve(result);
      }
    });
  });
}

// 获取Vue路由
async function getVueRoutes() {
  const routes = await executeInPage(function() {
    function findVueRoot(root) {
      const queue = [root];
      while (queue.length > 0) {
        const currentNode = queue.shift();
        if (currentNode.__vue__ || currentNode.__vue_app__ || currentNode._vnode) {
          return currentNode;
        }
        for (let i = 0; i < currentNode.childNodes.length; i++) {
          queue.push(currentNode.childNodes[i]);
        }
      }
      return null;
    }

    function findVueRouter(vueRoot) {
      let router;
      try {
        if (vueRoot.__vue_app__) {
          router = vueRoot.__vue_app__.config.globalProperties.$router.options.routes;
        } else if (vueRoot.__vue__) {
          router = vueRoot.__vue__.$root.$options.router.options.routes;
        }
      } catch (e) {}
      try {
        if (vueRoot.__vue__ && !router) {
          router = vueRoot.__vue__._router.options.routes;
        }
      } catch (e) {}
      return router;
    }

    function walkRouter(rootNode, callback) {
      const stack = [{node: rootNode, path: ''}];
      while (stack.length) {
        const {node, path} = stack.pop();
        if (node && typeof node === 'object') {
          if (Array.isArray(node)) {
            for (const key in node) {
              stack.push({
                node: node[key],
                path: mergePath(path, node[key].path)
              });
            }
          } else if (node.hasOwnProperty("children")) {
            stack.push({node: node.children, path: path});
          }
        }
        callback(path, node);
      }
    }

    function mergePath(parent, path) {
      if (path.indexOf(parent) === 0) return path;
      return (parent ? parent + '/' : '') + path;
    }

    const vueRoot = findVueRoot(document.body);
    if (!vueRoot) return null;

    const routers = [];
    const vueRouter = findVueRouter(vueRoot);
    if (!vueRouter) return null;

    walkRouter(vueRouter, function(path, node) {
      if (node.path) {
        routers.push({name: node.name, path});
      }
    });

    return routers;
  });

  return routes;
}

// 获取页面大小
async function getPageSize() {
  return await executeInPage(function() {
    const appElement = document.getElementById('app');
    if (!appElement) return 0;
    
    const content = appElement.innerHTML;
    const textSize = new Blob([content]).size;
    
    const images = Array.from(appElement.getElementsByTagName('img'))
      .filter(img => img.complete && img.naturalWidth > 0);
    
    const imageSize = images.reduce((sum, img) => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      return sum + (width * height * 4);
    }, 0);

    const styles = Array.from(appElement.getElementsByTagName('style'));
    const styleSize = styles.reduce((sum, style) => {
      return sum + new Blob([style.textContent]).size;
    }, 0);

    return textSize + imageSize + styleSize;
  });
}

// 显示路由
function displayRoutes(routes) {
  if (testResults.length > 0) {
    displayResults(testResults);
    return;
  }

  const tbody = document.querySelector('#resultsTable tbody');
  tbody.innerHTML = routes.map((route, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${route.path}</td>
      <td>${route.name || '-'}</td>
      <td>-</td>
      <td>-</td>
    </tr>
  `).join('');
}

// 显示测试结果
function displayResults(results) {
  testResults = results;
  const tbody = document.querySelector('#resultsTable tbody');
  tbody.innerHTML = results.map((result, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${result.path}</td>
      <td>${result.name || '-'}</td>
      <td>${result.status}</td>
      <td>${result.size}</td>
    </tr>
  `).join('');
}

// 处理排序
function handleSort(column) {
  if (testResults.length === 0) {
    alert('没有可排序的数据');
    return;
  }

  if (currentSort.column === column) {
    currentSort.order = currentSort.order === 'desc' ? 'asc' : 'desc';
  } else {
    currentSort.column = column;
    currentSort.order = 'desc';
  }

  document.querySelectorAll('th[data-sort] .sort-caret').forEach(caret => {
    caret.classList.remove('active');
  });

  const th = document.querySelector(`th[data-sort="${column}"]`);
  const indicator = currentSort.order === 'asc' 
    ? th.querySelector('.ascending') 
    : th.querySelector('.descending');
  indicator.classList.add('active');

  const sortedResults = [...testResults].sort((a, b) => {
    let valueA = column === 'size' ? a.size : a.status;
    let valueB = column === 'size' ? b.size : b.status;
    valueA = typeof valueA === 'number' ? valueA : 0;
    valueB = typeof valueB === 'number' ? valueB : 0;
    return currentSort.order === 'asc' ? valueA - valueB : valueB - valueA;
  });

  displayResults(sortedResults);
}

// 修改 URL 处理相关的代码
function cleanUrl(url) {
  // 移除末尾的斜杠
  return url.replace(/\/$/, '');
}

// 初始化事件监听器
document.addEventListener('DOMContentLoaded', async () => {
  const currentUrl = await getCurrentUrl();
  document.getElementById('baseUrl').value = cleanUrl(currentUrl.split('#')[0]);

  // 获取接口按钮
  document.getElementById('getRoutes').addEventListener('click', async () => {
    const routes = await getVueRoutes();
    if (!routes) {
      alert('未检测到Vue路由');
      return;
    }
    currentRoutes = routes;
    displayRoutes(routes);
  });

  // 测试接口按钮
  document.getElementById('testRoutes').addEventListener('click', async () => {
    if (isTestRunning) {
      alert('测试已在进行中');
      return;
    }

    if (!currentRoutes.length) {
      alert('请先获取接口');
      return;
    }

    const baseUrl = document.getElementById('baseUrl').value.trim();
    if (!baseUrl) {
      alert('请输入基础URL');
      return;
    }

    const results = [];
    let completedTests = 0;
    const totalTests = currentRoutes.length;
    const button = document.getElementById('testRoutes');
    const originalText = button.textContent;
    
    isTestRunning = true;
    shouldStopTest = false;
    document.getElementById('stopTest').style.display = 'inline-block';

    try {
      for (const route of currentRoutes) {
        if (shouldStopTest) {
          console.log('测试已停止');
          break;
        }

        const cleanBaseUrl = cleanUrl(baseUrl);
        const url = `${cleanBaseUrl}/#${route.path}`;
        
        completedTests++;
        button.textContent = `测试中... (${completedTests}/${totalTests})`;

        await executeInPage(
          function(url) { window.location.href = url; },
          url
        );

        await new Promise(resolve => setTimeout(resolve, 1500));

        const size = await getPageSize();

        results.push({
          ...route,
          status: 200,
          size: size || 0
        });

        displayResults(results);
      }

      if (!shouldStopTest) {
        await executeInPage(
          function(url) { window.location.href = url; },
          cleanUrl(baseUrl)
        );
      }

    } catch (error) {
      console.error('测试失败:', error);
      alert('测试过程中出错');
    } finally {
      isTestRunning = false;
      shouldStopTest = false;
      button.textContent = originalText;
      document.getElementById('stopTest').style.display = 'none';
    }
  });

  // 添加停止按钮的处理函数
  document.getElementById('stopTest').addEventListener('click', () => {
    if (isTestRunning) {
      shouldStopTest = true;
      console.log('正在停止测试...');
    }
  });

  // 复制接口按钮
  document.getElementById('copyRoutes').addEventListener('click', () => {
    if (!currentRoutes.length) {
      alert('没有可复制的接口信息');
      return;
    }
    const routeText = currentRoutes.map(r => r.path).join('\n');
    navigator.clipboard.writeText(routeText)
      .then(() => alert('复制成功'))
      .catch(() => alert('复制失败'));
  });

  // 排序事件
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      handleSort(th.dataset.sort);
    });
  });

  // 初始化时隐藏停止按钮
  document.getElementById('stopTest').style.display = 'none';
});