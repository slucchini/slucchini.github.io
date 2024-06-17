$(document).ready(function(){
	$('#nav-icon1').click(function(){
		$(this).toggleClass('open');
		$('#nav').toggleClass('open');
	});

	$('#nav-icon2').click(function(){
		$(this).toggleClass('open');
		$('.paper-nav').toggleClass('open');
	})

	$('.buttons>a').click(function(){
		// console.log($(this))
		$('.buttons>a').each(function(){
			$(this).removeClass('active')
		});
		if ($(this)[0].classList.length >= 1) {
			// window.location.href = window.location.href + '#'+$(this)[0].classList[0];
			// window.location.search = '?'+$(this)[0].classList[0];
			if (history.pushState) {
				var newurl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?' + $(this)[0].classList[0];
				window.history.pushState({path:newurl},'',newurl);
			}
		}
		$(this).toggleClass('active');
		window.location.hash = '';
		showResearch(this)
		updatePaperNav();
	})
	
	if (window.location.pathname.endsWith("research")) {
		if (window.location.search == '') {
			showResearch($('.buttons>a.active'))
		} else {
			$('.buttons>a.'+window.location.search.substring(1)).click()
		}

		$(window).scroll(function () {
			if($(window).scrollTop() > ($('.buttons').offset().top-window.innerHeight/2.)) {
				updatePaperNav();
			} else {
				// $('.paper-nav').css('position', '');
				$('.paper-nav').css('left', '-250px');
				$('.paper-nav').removeClass('open');
				$('#nav-icon2').removeClass('open');
			}
		  });
	}
});

function updatePaperNav() {
	if (window.location.search == '') {
		research = 'magellanic';
	} else {
		research = window.location.search.substring(1);
	}
	if ($('.paper-nav-content-container>.content.'+research).length == 0) {
		$('.paper-nav').css('display','none');
		return;
	} else {
		$('.paper-nav').css('display','block');
	}

	if (window.matchMedia('(min-width: 800px)').matches) {
		$('.paper-nav').css('left',0);
		return;
	}

	console.log(research);
	switch (research) {
		case 'magellanic':
			navLeft = '-110px';
			break;
		case 'gaia':
			navLeft = '-130px';
			break;
		default:
			navLeft = '-250px';
	}
	$('.paper-nav').css('left',navLeft);
}

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