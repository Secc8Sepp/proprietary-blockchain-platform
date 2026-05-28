window.LayoutEngine = {
    draggedItem: null,
    draggedSection: null,

    init() {
        this.loadLayoutSettings();
        this.initResizers();
        this.initDraggableItems();
        this.initCollapsers();

        document.querySelectorAll('.side-card-header').forEach(header => {
            header.setAttribute('draggable', 'true');
        });
        console.log('[INIT] Layout Engine ready.');
    },

    initCollapsers() {
        const leftSidebar = document.getElementById('side-nav-left');
        const rightSidebar = document.getElementById('side-nav-right');

        const createCollapser = (sidebar, direction) => {
            if (!sidebar) return;
            const button = document.createElement('button');
            button.className = `sidebar-collapse-btn ${direction}`;
            button.title = `Collapse ${direction} sidebar`;
            button.innerHTML = direction === 'left' ? '&laquo;' : '&raquo;';
            
            Object.assign(button.style, {
                position: 'absolute',
                top: '50%',
                transform: 'translateY(-50%)',
                zIndex: '1001',
                cursor: 'pointer',
                padding: '10px 2px',
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
                color: 'var(--text-muted)',
                fontSize: '14px',
                lineHeight: '1',
            });

            if (direction === 'left') {
                button.style.right = '-16px';
                button.style.borderTopRightRadius = '8px';
                button.style.borderBottomRightRadius = '8px';
                button.style.borderLeft = 'none';
            } else {
                button.style.left = '-16px';
                button.style.borderTopLeftRadius = '8px';
                button.style.borderBottomLeftRadius = '8px';
                button.style.borderRight = 'none';
            }

            sidebar.style.position = 'relative';
            sidebar.appendChild(button);

            button.addEventListener('click', () => {
                const isCollapsed = sidebar.classList.toggle('collapsed');
                if (isCollapsed) {
                    sidebar.dataset.oldWidth = sidebar.style.flexBasis;
                    sidebar.style.flexBasis = '0px';
                    button.innerHTML = direction === 'left' ? '&raquo;' : '&laquo;';
                    button.title = `Expand ${direction} sidebar`;
                } else {
                    sidebar.style.flexBasis = sidebar.dataset.oldWidth || '280px';
                    button.innerHTML = direction === 'left' ? '&laquo;' : '&raquo;';
                    button.title = `Collapse ${direction} sidebar`;
                }
                this.saveLayoutSettings();
            });
        };

        createCollapser(leftSidebar, 'left');
        createCollapser(rightSidebar, 'right');
    },

    getDragAfterElement(container, y, selector) {
        if (!container) return null;
        const draggableElements = [...container.querySelectorAll(`${selector}:not(.dragging)`)];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    },

    initDraggableItems() {
        document.addEventListener('dragstart', (e) => {
            if (e.target.classList.contains('profile-section')) {
                if(window.viewingUserPublicKey !== window.CoreEngine.userKeys.publicKey) {
                    e.preventDefault();
                    return;
                }
                this.draggedSection = e.target;
                e.target.classList.add('dragging');
                e.target.style.opacity = 0.5;
            } else if (e.target.classList.contains('playlist-item')) {
                 if(window.viewingUserPublicKey !== window.CoreEngine.userKeys.publicKey) {
                    e.preventDefault();
                    return;
                }
                this.draggedSection = e.target;
                e.target.classList.add('dragging');
                e.target.style.opacity = 0.5;
            } else if (e.target.classList.contains('side-card-header')) {
                this.draggedItem = e.target.closest('.side-card');
                if (this.draggedItem) {
                    setTimeout(() => {
                        if (this.draggedItem) this.draggedItem.classList.add('dragging');
                    }, 0);
                }
            }
        });

        document.addEventListener('dragend', (e) => {
            if (this.draggedSection) {
                this.draggedSection.style.opacity = "";
                this.draggedSection.classList.remove('dragging');
                this.draggedSection = null;
            }
            if (this.draggedItem) {
                this.draggedItem.classList.remove('dragging');
                this.draggedItem = null;
                this.saveLayoutSettings();
            }
        });

        document.addEventListener('dragover', (e) => {
            e.preventDefault();

            const handleDrag = (draggedEl, itemSelector, containerSelector) => {
                if (!draggedEl) return;
                const container = e.target.closest(containerSelector);
                if (container) {
                    const afterElement = this.getDragAfterElement(container, e.clientY, itemSelector);
                    if (afterElement == null) {
                        container.appendChild(draggedEl);
                    } else {
                        container.insertBefore(draggedEl, afterElement);
                    }
                }
            };

            if (this.draggedSection) {
                if (this.draggedSection.classList.contains('profile-section')) {
                    handleDrag(this.draggedSection, '.profile-section', '.profile-sortable');
                } else if (this.draggedSection.classList.contains('playlist-item')) {
                    handleDrag(this.draggedSection, '.playlist-item', '#ui-profile-playlist');
                }
            } else if (this.draggedItem) {
                 handleDrag(this.draggedItem, '.side-card', '.side-nav');
            }
        });
    },

    initProfileDraggables() {
    },

    initResizers() {
        const leftResizer = document.getElementById('resizer-left');
        const rightResizer = document.getElementById('resizer-right');
        const leftSidebar = document.getElementById('side-nav-left');
        const rightSidebar = document.getElementById('side-nav-right');

        const createResizerHandler = (sidebar, resizer, direction) => {
            if (!sidebar || !resizer) return;
            resizer.addEventListener('mousedown', (e) => {
                if (sidebar.classList.contains('collapsed')) {
                    return;
                }

                e.preventDefault();
                resizer.classList.add('active');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';

                const mouseMoveHandler = (moveEvent) => {
                    let newWidth;
                    if (direction === 'left') {
                        newWidth = moveEvent.clientX;
                    } else { // right
                        newWidth = window.innerWidth - moveEvent.clientX;
                    }

                    if (newWidth > 600) {
                        sidebar.style.flexBasis = '600px';
                    } else if (newWidth < 150) {
                        sidebar.style.flexBasis = '150px';
                    } else {
                        sidebar.style.flexBasis = newWidth + 'px';
                    }
                };

                const mouseUpHandler = () => {
                    resizer.classList.remove('active');
                    document.body.style.cursor = 'default';
                    document.body.style.userSelect = 'auto';
                    document.removeEventListener('mousemove', mouseMoveHandler);
                    document.removeEventListener('mouseup', mouseUpHandler);
                    this.saveLayoutSettings();
                };

                document.addEventListener('mousemove', mouseMoveHandler);
                document.addEventListener('mouseup', mouseUpHandler);
            });
        };

        createResizerHandler(leftSidebar, leftResizer, 'left');
        createResizerHandler(rightSidebar, rightResizer, 'right');
    },

    initDraggableSidebars() {
    },

    saveLayoutSettings() {
        const leftSidebar = document.getElementById('side-nav-left');
        const rightSidebar = document.getElementById('side-nav-right');
        if (leftSidebar) {
            localStorage.setItem('vod_layout_left_width', leftSidebar.style.flexBasis);
            localStorage.setItem('vod_layout_left_collapsed', leftSidebar.classList.contains('collapsed'));
            const leftOrder = Array.from(leftSidebar.querySelectorAll('.side-card')).map(c => c.id);
            localStorage.setItem('vod_layout_left_order', JSON.stringify(leftOrder));
        }
        if (rightSidebar) {
            localStorage.setItem('vod_layout_right_width', rightSidebar.style.flexBasis);
            localStorage.setItem('vod_layout_right_collapsed', rightSidebar.classList.contains('collapsed'));
            const rightOrder = Array.from(rightSidebar.querySelectorAll('.side-card')).map(c => c.id);
            localStorage.setItem('vod_layout_right_order', JSON.stringify(rightOrder));
        }
    },

    loadLayoutSettings() {
        const leftSidebar = document.getElementById('side-nav-left');
        const rightSidebar = document.getElementById('side-nav-right');

        const applySettings = (sidebar, direction) => {
            if (!sidebar) return;

            const width = localStorage.getItem(`vod_layout_${direction}_width`);
            if (width) sidebar.style.flexBasis = width;

            const isCollapsed = localStorage.getItem(`vod_layout_${direction}_collapsed`) === 'true';
            const button = sidebar.querySelector('.sidebar-collapse-btn');

            if (isCollapsed) {
                sidebar.classList.add('collapsed');
                sidebar.style.flexBasis = '0px';
                if (button) {
                    button.innerHTML = direction === 'left' ? '&raquo;' : '&laquo;';
                    button.title = `Expand ${direction} sidebar`;
                }
            }

            const order = JSON.parse(localStorage.getItem(`vod_layout_${direction}_order`) || 'null');
            if (order) {
                order.forEach(cardId => {
                    const card = document.getElementById(cardId);
                    if (card) sidebar.appendChild(card);
                });
            }
        };

        applySettings(leftSidebar, 'left');
        applySettings(rightSidebar, 'right');
    }
};