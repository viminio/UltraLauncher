document.getElementById('welcomeButton').addEventListener('click', e => {
    loginOptionsCancelEnabled(false)
    loginOptionsViewOnLoginSuccess = VIEWS.landing
    loginOptionsViewOnLoginCancel = VIEWS.loginOptions
    switchView(VIEWS.welcome, VIEWS.loginOptions)
})