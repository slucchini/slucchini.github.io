$(document).ready(function(){
	$('#nav-icon1').click(function(){
		$(this).toggleClass('open');
		$('#nav').toggleClass('open');
	});

	$('.buttons>a').click(function(){
		console.log($(this))
		$('.buttons>a').each(function(){
			$(this).removeClass('active')
		});
		if ($(this)[0].classList.length >= 1) {
			// window.location.href = window.location.href + '#'+$(this)[0].classList[0];
			window.location.hash = '#'+$(this)[0].classList[0];
		}
		$(this).toggleClass('active');
		showResearch(this)
	})
	
	if (window.location.pathname.endsWith("research")) {
		if (window.location.hash == '') {
			showResearch($('.buttons>a.active'))
		} else {
			$('.buttons>a.'+window.location.hash.substring(1)).click()
		}
	}
});

function showResearch(activeButton) {
	var activeClass = ''
	$('.buttons>a.active').attr('class').split(' ').forEach(function(item,indx,arr) {
		if (item != 'active') {
			activeClass = item
		}
	})
	$('div#body .content').each(function(){
		$(this).addClass('hidden')
	})
	$('div#body .content.'+activeClass).each(function(){
		$(this).removeClass('hidden')
	})
	$('.underliner').css('left',$(activeButton).position().left+14)
	$('.underliner').css('width',$(activeButton).width()+14)
}